import {readFile,mkdir,writeFile,access} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {execFileSync} from "node:child_process";

const source=resolve(process.argv[2] || "D:/Downloads/4921644-hd_1066_1920_25fps.mp4");
const ffmpeg=resolve(process.argv[3] || ".artifacts/video-test-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe");
const output=resolve(".artifacts/validation-fixtures");
await access(ffmpeg); await mkdir(output,{recursive:true});
const sourceSha256=createHash("sha256").update(await readFile(source)).digest("hex");
const transforms=[
  ["rear-occluded.mp4","drawbox=x=0:y=ih*0.68:w=iw:h=ih*0.32:color=black:t=fill"],
  ["rear-dark.mp4","eq=brightness=-0.3:gamma=0.7"],
  ["blank.mp4","lutrgb=r=0:g=0:b=0"],
];
const records=[];
for(const [name,filter] of transforms) {
  const path=resolve(output,name);
  execFileSync(ffmpeg,["-hide_banner","-loglevel","error","-n","-i",source,"-an","-vf",filter,
    "-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p",path],{stdio:"inherit"});
  records.push({name,filter,sha256:createHash("sha256").update(await readFile(path)).digest("hex")});
}
await writeFile(resolve(output,"provenance.json"),JSON.stringify({sourceSha256,createdAt:new Date().toISOString(),
  purpose:"Synthetic robustness conditions from one development clip, not independent participants",records},null,2));
console.log(JSON.stringify({sourceSha256,output,created:records.map(record=>record.name)}));
