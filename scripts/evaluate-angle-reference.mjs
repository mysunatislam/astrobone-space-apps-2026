import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {evaluateTimedAngleReference} from "../src/angleReferenceValidation.js";

if(!process.argv[2] || !process.argv[3]) throw new Error("Usage: node scripts/evaluate-angle-reference.mjs <run.json> <reference.json> [output-directory]");
const runBytes=await readFile(resolve(process.argv[2])), referenceBytes=await readFile(resolve(process.argv[3]));
const result=evaluateTimedAngleReference(JSON.parse(runBytes),JSON.parse(referenceBytes));
result.evaluatedAt=new Date().toISOString();
result.inputHashes={run:createHash("sha256").update(runBytes).digest("hex"),reference:createHash("sha256").update(referenceBytes).digest("hex")};
const output=resolve(process.argv[4]||`.artifacts/validation/reference-${Date.now()}`);
await mkdir(output,{recursive:true});
await writeFile(resolve(output,"reference-evaluation.json"),JSON.stringify(result,null,2));
for(const side of ["left","right"]) await writeFile(resolve(output,`${side}-reference-pairs.json`),JSON.stringify(result.channels[side].pairs,null,2));
console.log(JSON.stringify({output,matchedFrames:result.matchedFrames,left:result.channels.left.metrics,right:result.channels.right.metrics},null,2));
