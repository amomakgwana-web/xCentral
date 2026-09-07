// End-to-end test of the live capture wizard, driven by Chromium's
// synthetic camera — a real MediaStream carrying a test pattern, so
// getUserMedia, the frame grabs and the image-quality maths all run
// for real. Only the photons are fake.
//
//   npm run build && node tests/run-onboarding-wizard.mjs
//
// Covers both paths that matter: a capture below the quality bar is
// REFUSED with a remedy, and a sharp one is accepted, matched, and
// carried through to the agents.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

// Chromium lives in different places depending on where this runs: an
// explicit override, the Playwright registry that `playwright install`
// populates on CI, or a preinstalled copy. Try them in that order and
// say clearly which was used.
function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const fromRegistry = chromium.executablePath();
    if (fromRegistry && existsSync(fromRegistry)) return fromRegistry;
  } catch { /* not installed through the registry */ }
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (existsSync(preinstalled)) return preinstalled;
  throw new Error(
    'No Chromium found. Run `npx playwright install chromium`, or set CHROMIUM_PATH.');
}


const ROOT = new URL('../dist', import.meta.url).pathname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(rq,rs)=>{try{
  const p=join(ROOT,rq.url==='/'?'index.html':decodeURIComponent(rq.url.split('?')[0]));
  const b=await readFile(p);rs.writeHead(200,{'Content-Type':MIME[extname(p)]??'application/octet-stream'});rs.end(b);
}catch{rs.writeHead(404);rs.end('nf');}});
await new Promise(r=>server.listen(4185,r));

// Chromium's synthetic camera: a real MediaStream with a moving test
// pattern, so getUserMedia, frame grabs and the quality maths all run
// for real — only the photons are fake.
const browser=await chromium.launch({
  executablePath: resolveChromium(),
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
        '--allow-file-access-from-files'],
});
const ctx=await browser.newContext({viewport:{width:1400,height:1000},permissions:['camera']});
const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
page.on('console',m=>{ if(m.type()==='error'&&!/fonts\.googleapis|ERR_CONNECTION/.test(m.text())) errs.push('console: '+m.text()); });

// Minimal stub: only what the wizard calls. Everything under test —
// camera, quality maths, cropping, liveness — is the shipped code.
await page.addInitScript(() => {
  const calls = [];
  window.__CALLS = calls;
  const rec = (name, args) => { calls.push({ name, args }); };

  const STUB = {
    env:'sandbox', configured:true,
    getProfile: async () => ({ name:'Operator' }),
    hasPermission: async () => true,
    fetchPlatforms: async () => ([{id:'biprapay',name:'BipraPay'},{id:'xpayments',name:'xPayments'}]),
    fetchCases: async () => [], fetchDashboard: async () => ({total:0,byStatus:{},verified:0,passRate:null,needsReview:0,inProgress:0,recent:[]}),
    validateSaId: async () => ({valid:true,date_of_birth:'1990-01-01',age:36,gender:'male',citizenship:'citizen',reason_codes:[]}),

    verifyIdentity: async (a) => { rec('verifyIdentity', a);
      return { caseId:'VC-2026-000999', subjectId:'11111111-2222-3333-4444-555555555555',
               identity:{ structureValid:true, dateOfBirth:'1990-01-01' } }; },
    openCaptureSession: async (a) => { rec('openCaptureSession', a);
      return { sessionId:'CS-2026-000042', status:'capturing',
               requiredSteps:['consent','document','selfie','match'],
               expiresAt:new Date(Date.now()+7.2e6).toISOString() }; },

    // The real thresholds, so a genuinely poor frame is genuinely refused.
    checkCaptureQuality: async (type, m) => { rec('checkCaptureQuality', { type, m });
      const reasons = [];
      const minSharp = type === 'document_portrait' ? 45 : type.startsWith('document') ? 90 : 80;
      if ((m.sharpness ?? 0) < minSharp) reasons.push('image_too_blurred');
      if ((m.brightness ?? 0) < 25) reasons.push('image_too_dark');
      if ((m.brightness ?? 0) > 95) reasons.push('image_overexposed');
      return { passed: reasons.length === 0, score: reasons.length ? 40 : 96, reason_codes: reasons };
    },

    submitCapture: async (a) => { rec('submitCapture', { type:a.captureType, source:a.source,
        hasImage: !!a.imageBase64, metrics:a.metrics, liveness:a.liveness });
      if (a.captureType === 'document_portrait')
        return { captureId:'cap-p', accepted:true, template:{ id:'tmpl-1', source:'document_portrait' } };
      if (a.captureType === 'document_front')
        return { captureId:'cap-d', accepted:true, quality:{score:96} };
      if (a.captureType === 'fingerprint')
        return { captureId:'cap-f', accepted:true };
      return { captureId:'cap-s', accepted:true, quality:{score:94},
               liveness:{ passed:true, score:91 },
               match:{ matched:true, similarity:0.8412, threshold:0.68,
                       operatingFmr:'1e-5', confidence:87 } };
    },

    adjudicate: async (a) => { rec('adjudicate', a);
      return { runId:'run-1', recommendation:'approve', confidence:91.4, vetoedBy:null,
        summary:'Every agent with evidence to judge passed.', awaitingHuman:true,
        decisions:[
          {agent:'Identity Agent',agentId:'identity_agent',remit:'Is the identity well-formed, real, alive, and not on a list?',canVeto:true,verdict:'pass',confidence:93,rationale:'The identity number checks out arithmetically and the authority holds a matching record.',evidence:{},reasonCodes:[]},
          {agent:'Document Agent',agentId:'document_agent',remit:'Is the document genuine, current, and does it belong to this person?',canVeto:true,verdict:'pass',confidence:90,rationale:'The document is current and no tampering was detected.',evidence:{},reasonCodes:[]},
          {agent:'Biometric Agent',agentId:'biometric_agent',remit:'Is the person in front of the camera the person on the document?',canVeto:true,verdict:'pass',confidence:92,rationale:'The live capture matches the document portrait with a clear margin, and a live person was present.',evidence:{},reasonCodes:[]},
          {agent:'Fraud Agent',agentId:'fraud_agent',remit:'Does anything here link to a pattern we have seen before?',canVeto:true,verdict:'pass',confidence:80,rationale:'No fraud rule fired.',evidence:{},reasonCodes:[]},
          {agent:'Affordability Agent',agentId:'affordability_agent',remit:'Can this person carry what they are asking for, under the NCA?',canVeto:false,verdict:'abstain',confidence:0,rationale:'No affordability assessment exists. Fine for an identity-only onboarding.',evidence:{},reasonCodes:['no_affordability_assessment']},
          {agent:'Compliance Agent',agentId:'compliance_agent',remit:'Is there lawful basis for everything we have done?',canVeto:true,verdict:'pass',confidence:92,rationale:'Live consent is on record for every purpose processed here.',evidence:{},reasonCodes:[]},
        ]};
    },
    applyAgentDecision: async (...a) => { rec('applyAgentDecision', a); return { ok:true }; },
    onboardCustomer: async (a) => { rec('onboardCustomer', a);
      return { customerId:'cust-9', fraudScreen:{ signals:0, critical:0 } }; },

    fetchCustomers: async () => [], fetchContracts: async () => [], fetchAssets: async () => [],
    fetchPayments: async () => [], fetchArrearsBook: async () => [], fetchFraudAlerts: async () => [],
    fetchFraudSignals: async () => [], fetchFraudRules: async () => [], fetchSubjects: async () => [],
    fetchConsents: async () => [], fetchConsentTexts: async () => [], fetchWatchlist: async () => [],
    fetchWatchlistHits: async () => [], fetchModalities: async () => [], fetchDuplicateFlags: async () => [],
    fetchBureaus: async () => [], fetchDocumentTypes: async () => [], fetchRequirements: async () => [],
    fetchRetentionPolicies: async () => [], fetchDsarRequests: async () => [], fetchApiKeys: async () => [],
    fetchApiRequests: async () => [], fetchAuditLog: async () => [], subscribeCases: () => ({}),
  };
  Object.defineProperty(window,'XC_DB',{get:()=>STUB,set:()=>{},configurable:true});
});

await page.goto('http://localhost:4185/',{waitUntil:'domcontentloaded'});
await page.waitForSelector('.nav-btn[data-page="onboard"]');
await page.click('.nav-btn[data-page="onboard"]');
await page.waitForSelector('#wizStart');
console.log('step 1  : applicant form rendered');

await page.fill('#wizFirst','Thabo');
await page.fill('#wizSurname','Mokoena');
await page.fill('#wizId','9001015009086');
await page.waitForTimeout(350);
console.log('        · ID hint:', (await page.locator('#wizIdHint').textContent())?.trim());

await page.check('#wizConsent');
await page.click('#wizStart');
await page.waitForSelector('#wizDocCapture',{timeout:8000});
console.log('step 2  : session opened, document step rendered');

// The camera must actually produce frames for the metrics to compute.
await page.waitForSelector('#stageVideo',{timeout:8000});
await page.waitForFunction(() => {
  const v = document.getElementById('stageVideo');
  return v && v.videoWidth > 0;
},{timeout:10000});
await page.waitForTimeout(1200);
const liveMetrics = await page.locator('#metrics').innerText();
console.log('        · live metrics:', liveMetrics.replace(/\s+/g,' ').trim());

// Chromium's synthetic feed is a soft rolling pattern, well under the
// document sharpness bar — so this exercises the REFUSAL path, which
// is the one that matters most: a blurred scan must be sent back with
// a remedy rather than silently matched.
await page.click('#wizDocCapture');
await page.waitForSelector('#wizDocResult .note-danger',{timeout:15000});
const refusal = (await page.locator('#wizDocResult').innerText()).replace(/\s+/g,' ');
console.log('        · REFUSED as designed:', refusal.slice(0,130));
if (!/refused/i.test(refusal)) { console.log('FAIL expected a refusal'); process.exitCode = 1; }

// Now the acceptance path, via upload with a genuinely sharp image.
await page.waitForTimeout(2200);
await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1000;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, c.width, c.height);
  // High-frequency detail so the Laplacian variance is genuinely high.
  for (let y = 0; y < 1000; y += 8)
    for (let x = 0; x < 1600; x += 8) {
      ctx.fillStyle = ((x / 8 + y / 8) % 2) ? '#101010' : '#f8f8f8';
      ctx.fillRect(x, y, 8, 8);
    }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
  const file = new File([blob], 'document.jpg', { type: 'image/jpeg' });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.getElementById('wizDocUpload');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForSelector('#wizNextSelfie',{timeout:20000});
console.log('        · ACCEPTED on upload:',
  (await page.locator('#wizDocResult .note').innerText()).replace(/\s+/g,' ').slice(0,140));

await page.click('#wizNextSelfie');
await page.waitForSelector('#wizSelfieCapture',{timeout:8000});
await page.waitForFunction(() => {
  const v = document.getElementById('stageVideo');
  return v && v.videoWidth > 0;
},{timeout:10000});
await page.waitForTimeout(900);
console.log('step 3  : selfie step, camera live');

// Same for the selfie: upload a sharp frame so the match path runs.
await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 960; c.height = 960;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d8cfc4'; ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < 960; y += 6)
    for (let x = 0; x < 960; x += 6) {
      ctx.fillStyle = ((x / 6 + y / 6) % 2) ? '#2a2320' : '#efe7dd';
      ctx.fillRect(x, y, 6, 6);
    }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
  const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.getElementById('wizSelfieUpload');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForSelector('#wizNextFinger',{timeout:25000});
const matchText = await page.locator('#wizSelfieResult').innerText();
console.log('        ·', matchText.replace(/\s+/g,' ').slice(0,150));


await page.click('#wizNextFinger');
await page.waitForSelector('#wizFingerSkip',{timeout:8000});
console.log('step 4  : fingerprint step rendered');
await page.click('#wizFingerSkip');

await page.waitForSelector('.agent',{timeout:20000});
const agents = await page.locator('.agent-name').allTextContents();
console.log('step 5  : agents ran —', agents.length, 'verdicts');
agents.forEach(a=>console.log('          ', a.replace(/\s+/g,' ').trim()));


await page.click('#wizAccept');
await page.waitForSelector('#wizRestart',{timeout:10000});
console.log('        ·', (await page.locator('#wizFinal .note').innerText()).replace(/\s+/g,' '));

// What actually reached the hub.
const calls = await page.evaluate(() => window.__CALLS);
console.log('\ncalls made:');
for (const c of calls) {
  if (c.name === 'submitCapture') {
    const m = c.args.metrics ?? {};
    console.log(`  submitCapture ${String(c.args.type).padEnd(18)} source=${c.args.source ?? '-'} `
      + `image=${c.args.hasImage} sharp=${m.sharpness} bright=${m.brightness} `
      + `${m.faceDetectionAvailable ? 'faces=' + m.faceCount : 'faceApi=unavailable'}`);
  } else {
    console.log('  ' + c.name);
  }
}
console.log('\nerrors:', errs.length ? errs : 'none');
await browser.close(); server.close();
console.log(errs.length || process.exitCode
  ? '\n WIZARD TEST FAILED'
  : '\n──────────  ONBOARDING WIZARD TEST PASSED  ──────────');
process.exit(errs.length || process.exitCode ? 1 : 0);
