import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const base=process.argv[2] || 'http://127.0.0.1:5173/';
const out=resolve('.artifacts/health-upgrade'); await mkdir(out,{recursive:true});
const axe=await readFile(resolve(process.env.AXE_CORE || '../qa-tools/node_modules/axe-core/axe.min.js'),'utf8');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {channel:'chrome'}),headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report=[];
// Fixtures exist only in isolated Playwright contexts, never in the user's browser.
const fixture=[0,1,2].map(i=>({schema:'astrobone-self-check-v1',id:'QA-baseline-'+i,profileId:'you',at:new Date(Date.UTC(2026,9,27+i,8)).toISOString(),values:{restingHr:64+i,sleepHours:7.5,mood:7},protocols:{restingHr:'resting-self-reported-v1'},quality:{restingHr:true,sleepHours:true,mood:true},sources:{restingHr:'QA disposable instrument',sleepHours:'Self-report',mood:'Self-report'},redFlags:{},symptoms:{},complete:true}));
async function ready(page) {
 await page.waitForFunction(()=>Boolean(window.__astroboneTwin?.selfCheck?.snapshot),null,{timeout:60000});
 await page.waitForFunction(()=>!document.body.classList.contains('tw-booting'),null,{timeout:60000});
 const start=page.getByRole('button',{name:/start my check/i}); if(await start.count() && await start.first().isVisible()) await start.first().click();
 await page.evaluate(()=>window.__astroboneTwin.scene.setPaused(true));
}
async function scan(page,label) {
 await page.addScriptTag({content:axe});
 const violations=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
 await writeFile(resolve(out,label+'-accessibility.json'),JSON.stringify(violations,null,2));
 return violations;
}
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  const context=await browser.newContext({viewport,reducedMotion:'reduce',acceptDownloads:true,serviceWorkers:'block'});
  const page=await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const log=text=>console.log('['+viewport.width+'] '+text);
  await page.addInitScript(records=>{if(!localStorage.getItem('qa-health-seeded')){localStorage.setItem('astrobone-self-check-consent','1');localStorage.setItem('astrobone-self-check-v1',JSON.stringify({you:records}));localStorage.setItem('qa-health-seeded','1');}},fixture);
  log('Personal dashboard and restored baseline'); await page.goto(base,{waitUntil:'domcontentloaded'}); await ready(page);
  await page.evaluate(()=>{window.__astroboneTwin.selfCheck.setProfile('you');window.__astroboneTwin.setExperience('mission');});
  const initial=await page.evaluate(()=>window.__astroboneTwin.selfCheck.snapshot('you'));
  assert.equal(initial.history.length,3); assert.equal(initial.latestCheck.id,'QA-baseline-2'); assert.ok(initial.evaluation);
  assert.equal(initial.evaluation.domains.flatMap(d=>d.indicators).find(r=>r.key==='restingHr').ref.count,2,'latest record is never included in its own baseline');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.screenshot({path:resolve(out,'personal-'+viewport.width+'.png'),fullPage:true,animations:'disabled',timeout:60000});
  log('Create a check and persist selected actions');
  await page.evaluate(()=>{const app=window.__astroboneTwin, sc=app.selfCheck;app.setExperience('selfcheck');sc.reset();Object.assign(sc.state.check,{values:{restingHr:82,sleepHours:6,mood:6},protocols:{restingHr:'resting-self-reported-v1'},sources:{restingHr:'QA disposable instrument'},quality:{restingHr:true,sleepHours:true,mood:true},redFlags:{},symptoms:{}});sc.go(5);});
  await page.getByRole('button',{name:'Save check & selected actions',exact:true}).click();
  await page.waitForFunction(()=>window.__astroboneTwin.selfCheck.snapshot('you').history.length===4);
  const saved=await page.evaluate(()=>window.__astroboneTwin.selfCheck.snapshot('you')); assert.ok(saved.followUps.length);
  const status=page.locator('select[data-followup-status]').first(); await status.selectOption('completed');
  await page.reload({waitUntil:'domcontentloaded'}); await ready(page);
  const restored=await page.evaluate(()=>window.__astroboneTwin.selfCheck.snapshot('you')); assert.equal(restored.history.length,4); assert.ok(restored.followUps.some(f=>f.status==='completed' && f.completedAt));
  log('NASA explanation and source-derived table');
  await page.evaluate(()=>{const a=window.__astroboneTwin;a.setExperience('selfcheck');a.selfCheck.go(5);});
  const detail=page.locator('[data-evidence-domain=cardiovascular]').first(); await detail.locator('summary').first().click(); await detail.locator('table').waitFor();
  assert.match(await detail.innerText(),/4 participants/);assert.ok((await detail.innerText()).includes('mg/L'));
  log('Passcode encryption, reload lock and unlock');
  await page.getByRole('button',{name:'Add a passcode',exact:true}).click();
  await page.locator('.sc-lock input[name=passcode]').fill('qa-private-health-2026');await page.locator('.sc-lock input[name=repeat]').fill('qa-private-health-2026');
  await page.locator('form.sc-lock button[type=submit]').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('astrobone-self-check-v1')).schema==='astrobone-sealed-v1');
  const raw=await page.evaluate(()=>localStorage.getItem('astrobone-self-check-v1'));assert.ok(!raw.includes('QA-baseline'));assert.ok(!raw.includes('restingHr'));
  await page.reload({waitUntil:'domcontentloaded'});await ready(page);
  assert.equal(await page.evaluate(()=>window.__astroboneTwin.selfCheck.snapshot('you').locked),true);
  await page.evaluate(()=>window.__astroboneTwin.setExperience('selfcheck'));
  await page.locator('.sc-lock input[name=passcode]').fill('qa-private-health-2026');await page.locator('form.sc-lock button[type=submit]').click();
  await page.waitForFunction(()=>window.__astroboneTwin.selfCheck.snapshot('you').history.length===4);
  log('Responsive interface and accessibility');await page.evaluate(()=>window.__astroboneTwin.setExperience('mission'));
  const violations=await scan(page,'personal-'+viewport.width);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  report.push({viewport,checks:['restored personal dashboard','historical baseline excludes itself','persistent followups and completion','contextual NASA human table','shared encryption','locked reload','unlock recovery','no horizontal overflow'],violations,errors});
  assert.deepEqual(errors,[]); await context.close();
 }
} finally {await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
if(report.some(r=>r.violations.length)) throw new Error('Accessibility violations: see .artifacts/health-upgrade.');
console.log('Connected health workflow checks passed.');
