const fs = require('fs');
const out = fs.createWriteStream('large.log');
for (let i = 0; i < 100000; i++) {
  out.write(`[2024-05-15T15:23:45.150+0000] [info] [gc] GC(1) Pause Init Mark 0.043ms\n`);
  out.write(`[2024-05-15T15:23:45.200+0000] [info] [gc] GC(1) Concurrent cleanup 100M->50M(1000M)\n`);
}
out.end();
