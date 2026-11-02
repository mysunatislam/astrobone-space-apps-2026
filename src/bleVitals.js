// Read a vital sign straight from a Bluetooth cuff, finger clip or thermometer that uses the standard
// Bluetooth SIG health profiles, so a reading is not mistyped. Web Bluetooth works in Chrome and Edge on
// desktop and Android (not Safari or iOS); where it is missing the app hides the button and typing still
// works. The parsers follow the Bluetooth SIG GATT Specification Supplement:
//   Blood Pressure Measurement 0x2A35 (Blood Pressure service 0x1810)
//   PLX Spot-Check Measurement 0x2A5E and PLX Continuous Measurement 0x2A5F (Pulse Oximeter service 0x1822)
//   Temperature Measurement 0x2A1C (Health Thermometer service 0x1809)
// Blood sugar is left out: the Glucose profile hands over stored records through a control point, not a
// fresh reading, and glucose meters that support it are rare. Values are numbers in the app's units
// (mmHg, %, °C) with any warning the device sent, never filled in silently: the form shows them first.

const KPA_TO_MMHG = 7.50062;

// IEEE 11073-20601 16-bit SFLOAT: 4-bit signed exponent, 12-bit signed mantissa. Special values
// (NaN, NRes, ±infinity, reserved) mean "no reading" and return null.
export function sfloat(raw) {
  const mantissa = raw & 0x0fff, exponent = raw >> 12;
  if ([0x07ff, 0x0800, 0x07fe, 0x0802, 0x0801].includes(mantissa)) return null;
  const m = mantissa >= 0x0800 ? mantissa - 0x1000 : mantissa, e = exponent >= 0x8 ? exponent - 0x10 : exponent;
  return Number((m * 10 ** e).toFixed(Math.max(0, -e)));
}
// 32-bit FLOAT: 8-bit signed exponent, 24-bit signed mantissa.
export function float32(raw) {
  const mantissa = raw & 0xffffff, exponent = (raw >>> 24) & 0xff;
  if ([0x7fffff, 0x800000, 0x7ffffe, 0x800002, 0x800001].includes(mantissa)) return null;
  const m = mantissa >= 0x800000 ? mantissa - 0x1000000 : mantissa, e = exponent >= 0x80 ? exponent - 0x100 : exponent;
  return Number((m * 10 ** e).toFixed(Math.max(0, -e)));
}
const view = data => (data instanceof DataView ? data : new DataView(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength));

// Blood pressure: flags, systolic, diastolic, mean arterial (SFLOAT), then optional time stamp (7 bytes),
// pulse rate (SFLOAT), user id (1 byte) and measurement status (16 bits).
const BP_STATUS = [[0, "the cuff felt body movement"], [1, "the cuff was too loose"], [2, "the pulse was irregular"], [5, "the arm was not in the right position"]];
export function parseBloodPressure(data) {
  const dv = view(data), flags = dv.getUint8(0), kpa = flags & 1;
  const unit = v => (v === null ? null : kpa ? Math.round(v * KPA_TO_MMHG) : Math.round(v));
  const systolic = unit(sfloat(dv.getUint16(1, true))), diastolic = unit(sfloat(dv.getUint16(3, true)));
  let i = 7;
  if (flags & 2) i += 7;
  const pulse = flags & 4 ? sfloat(dv.getUint16(i, true)) : null; if (flags & 4) i += 2;
  if (flags & 8) i += 1;
  const status = flags & 16 && dv.byteLength >= i + 2 ? dv.getUint16(i, true) : 0;
  const warnings = BP_STATUS.filter(([bit]) => status & (1 << bit)).map(([, text]) => text);
  return { kind: "bp", systolic, diastolic, pulse, warnings };
}

// Pulse oximeter: flags, SpO2 and pulse rate (SFLOAT). Spot-check and continuous share the first fields.
export function parsePulseOximeter(data) {
  const dv = view(data);
  return { kind: "spo2", spo2: sfloat(dv.getUint16(1, true)), pulse: sfloat(dv.getUint16(3, true)), warnings: [] };
}

// Thermometer: flags, temperature (FLOAT, °C or °F), optional time stamp, optional site.
// Site codes from the Temperature Type characteristic (0x2A1D) mapped to the app's thermometer sites.
const TEMP_TYPE_SITES = { 1: "armpit", 3: "ear", 6: "oral", 9: "ear" };
export function parseTemperature(data) {
  const dv = view(data), flags = dv.getUint8(0), raw = float32(dv.getUint32(1, true));
  const celsius = raw === null ? null : Number((flags & 1 ? (raw - 32) * 5 / 9 : raw).toFixed(1));
  let i = 5; if (flags & 2) i += 7;
  const type = flags & 4 && dv.byteLength > i ? dv.getUint8(i) : null;
  return { kind: "temp", celsius, site: TEMP_TYPE_SITES[type] ?? null, siteCode: type, warnings: [] };
}

// The three readers. Services and characteristics by their assigned 16-bit numbers.
export const BLE_VITALS = Object.freeze({
  bp: { label: "blood pressure cuff", service: 0x1810, characteristics: [0x2a35], parse: parseBloodPressure },
  spo2: { label: "pulse oximeter", service: 0x1822, characteristics: [0x2a5e, 0x2a5f], parse: parsePulseOximeter },
  temp: { label: "thermometer", service: 0x1809, characteristics: [0x2a1c], parse: parseTemperature },
});

export const bluetoothAvailable = (nav = globalThis.navigator) => Boolean(nav?.bluetooth?.requestDevice);

// Pick a device (the browser asks the person), wait for its next reading, then disconnect. A cuff sends
// its measurement when it finishes; a finger clip or thermometer when it has one. Resolves with the
// parsed reading plus the device name, or rejects with a sentence the form can show.
export async function readBluetoothVital(kind, { bluetooth = globalThis.navigator?.bluetooth, timeoutMs = 120000, onStatus = () => {} } = {}) {
  const spec = BLE_VITALS[kind];
  if (!spec) throw new Error(`Unknown reading "${kind}".`);
  if (!bluetooth?.requestDevice) throw new Error("This browser cannot use Bluetooth. Use Chrome or Edge on a computer or Android phone, or type the reading.");
  let device;
  try { device = await bluetooth.requestDevice({ filters: [{ services: [spec.service] }] }); } catch (error) {
    throw new Error(error?.name === "NotFoundError" ? `No ${spec.label} was chosen.` : `Bluetooth could not start: ${error?.message ?? error}`);
  }
  onStatus(`Connecting to ${device.name ?? `the ${spec.label}`}…`);
  const server = await device.gatt.connect();
  try {
    const service = await server.getPrimaryService(spec.service);
    let characteristic = null;
    for (const uuid of spec.characteristics) { try { characteristic = await service.getCharacteristic(uuid); break; } catch { /* try the next one */ } }
    if (!characteristic) throw new Error(`This ${spec.label} does not send readings in the standard format. Type the reading instead.`);
    onStatus(kind === "bp" ? "Connected. Start the measurement on the cuff." : "Connected. Take the reading on the device.");
    const reading = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { characteristic.removeEventListener("characteristicvaluechanged", onValue); reject(new Error("No reading arrived within 2 minutes.")); }, timeoutMs);
      function onValue(event) {
        try {
          const parsed = spec.parse(event.target.value);
          const missing = kind === "bp" ? parsed.systolic === null || parsed.diastolic === null : kind === "spo2" ? parsed.spo2 === null : parsed.celsius === null;
          if (missing) return; // the device sent a "no reading" value: keep waiting
          clearTimeout(timer); characteristic.removeEventListener("characteristicvaluechanged", onValue); resolve(parsed);
        } catch (error) { clearTimeout(timer); reject(new Error(`The reading could not be read: ${error.message}`)); }
      }
      characteristic.addEventListener("characteristicvaluechanged", onValue);
      characteristic.startNotifications().catch(error => { clearTimeout(timer); reject(error); });
    });
    return { ...reading, device: device.name ?? spec.label };
  } finally {
    try { server.disconnect?.() ?? device.gatt.disconnect?.(); } catch { /* already gone */ }
  }
}
