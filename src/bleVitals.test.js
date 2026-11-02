import test from "node:test";
import assert from "node:assert/strict";
import { sfloat, float32, parseBloodPressure, parsePulseOximeter, parseTemperature, readBluetoothVital, bluetoothAvailable, BLE_VITALS } from "./bleVitals.js";

const dv = bytes => new DataView(new Uint8Array(bytes).buffer);

test("SFLOAT and FLOAT decode values and special codes", () => {
  assert.equal(sfloat(0x0078), 120);
  assert.equal(sfloat(0xf16d), 36.5);
  assert.equal(sfloat(0x0fff), -1);
  for (const special of [0x07ff, 0x0800, 0x07fe, 0x0802]) assert.equal(sfloat(special), null);
  assert.equal(float32(0xff00016e), 36.6);
  assert.equal(float32(0x007fffff), null);
});

test("blood pressure: mmHg with pulse, user and status; kPa converted", () => {
  const r = parseBloodPressure(dv([0x1c, 0x78, 0x00, 0x50, 0x00, 0x5d, 0x00, 0x40, 0x00, 0x01, 0x05, 0x00]));
  assert.deepEqual(r, { kind: "bp", systolic: 120, diastolic: 80, pulse: 64, warnings: ["the cuff felt body movement", "the pulse was irregular"] });
  const withTime = parseBloodPressure(dv([0x06, 0x78, 0x00, 0x50, 0x00, 0x5d, 0x00, 0xea, 0x07, 11, 2, 8, 0, 0, 0x48, 0x00]));
  assert.equal(withTime.pulse, 72, "time stamp skipped");
  const kpa = parseBloodPressure(dv([0x01, 0xa0, 0xf0, 0x6b, 0xf0, 0x7c, 0xf0]));
  assert.equal(kpa.systolic, 120); assert.equal(kpa.diastolic, 80);
});

test("pulse oximeter and thermometer", () => {
  assert.deepEqual(parsePulseOximeter(dv([0x00, 0x61, 0x00, 0x48, 0x00])), { kind: "spo2", spo2: 97, pulse: 72, warnings: [] });
  const armpit = parseTemperature(dv([0x04, 0x6e, 0x01, 0x00, 0xff, 0x01]));
  assert.equal(armpit.celsius, 36.6); assert.equal(armpit.site, "armpit");
  const f = parseTemperature(dv([0x01, 0xda, 0x03, 0x00, 0xff]));
  assert.equal(f.celsius, 37); assert.equal(f.site, null);
  assert.equal(parseTemperature(dv([0x06, 0x6e, 0x01, 0x00, 0xff, 0xea, 0x07, 11, 2, 8, 0, 0, 0x03])).site, "ear");
});

// A fake browser Bluetooth stack: the device sends a "no reading" value first, then a measurement.
function fakeBluetooth(packets, { name = "Cuff BP-7", missingChar = false } = {}) {
  const calls = { disconnected: false, filters: null };
  const listeners = new Set();
  const characteristic = {
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    startNotifications: async () => { setTimeout(() => packets.forEach(p => [...listeners].forEach(fn => fn({ target: { value: dv(p) } }))), 5); return characteristic; },
  };
  const server = { getPrimaryService: async () => ({ getCharacteristic: async () => { if (missingChar) throw new Error("NotFound"); return characteristic; } }), disconnect: () => { calls.disconnected = true; } };
  return { calls, bluetooth: { requestDevice: async opts => { calls.filters = opts.filters; return { name, gatt: { connect: async () => server } }; } } };
}

test("reading from a device waits past 'no reading' values, returns the measurement and disconnects", async () => {
  const { bluetooth, calls } = fakeBluetooth([[0x00, 0xff, 0x07, 0xff, 0x07, 0xff, 0x07], [0x00, 0x8c, 0x00, 0x5a, 0x00, 0x6a, 0x00]]);
  const statuses = [];
  const r = await readBluetoothVital("bp", { bluetooth, onStatus: s => statuses.push(s) });
  assert.equal(r.systolic, 140); assert.equal(r.diastolic, 90); assert.equal(r.device, "Cuff BP-7");
  assert.deepEqual(calls.filters, [{ services: [BLE_VITALS.bp.service] }]);
  assert.equal(calls.disconnected, true);
  assert.match(statuses.at(-1), /Start the measurement on the cuff/);
});

test("clear messages when Bluetooth is missing, nothing is chosen, the format is not standard or no reading comes", async () => {
  assert.equal(bluetoothAvailable({}), false);
  await assert.rejects(readBluetoothVital("bp", { bluetooth: null }), /cannot use Bluetooth/);
  const cancel = { requestDevice: async () => { const e = new Error("User cancelled"); e.name = "NotFoundError"; throw e; } };
  await assert.rejects(readBluetoothVital("spo2", { bluetooth: cancel }), /No pulse oximeter was chosen/);
  const odd = fakeBluetooth([], { missingChar: true });
  await assert.rejects(readBluetoothVital("temp", { bluetooth: odd.bluetooth }), /standard format/);
  assert.equal(odd.calls.disconnected, true);
  const silent = fakeBluetooth([]);
  await assert.rejects(readBluetoothVital("temp", { bluetooth: silent.bluetooth, timeoutMs: 30 }), /No reading arrived/);
});

test("a cuff warning makes the blood pressure a reading to repeat", async () => {
  const { applyVitals, newCheck } = await import("./selfCheck.js");
  const vitals = w => ({ bp: { readings: [[120, 80]], rested: true, site: "arm", deviceWarnings: w } });
  assert.equal(applyVitals(newCheck("you"), vitals([])).quality.systolicBp, true);
  assert.equal(applyVitals(newCheck("you"), vitals(["the cuff felt body movement"])).quality.systolicBp, false);
});
