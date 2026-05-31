const str = "2024-05-15T15:23:45.150+0200";

function parseDateFastPath(timeValue) {
    if (timeValue.length >= 23 && timeValue.charCodeAt(4) === 45 && timeValue.charCodeAt(7) === 45) {
        const sep = timeValue.charCodeAt(10);
        if (sep === 84 || sep === 32) {
           const year = (timeValue.charCodeAt(0) - 48) * 1000 +
                        (timeValue.charCodeAt(1) - 48) * 100 +
                        (timeValue.charCodeAt(2) - 48) * 10 +
                        (timeValue.charCodeAt(3) - 48);
           const month = (timeValue.charCodeAt(5) - 48) * 10 +
                         (timeValue.charCodeAt(6) - 48) - 1;
           const day = (timeValue.charCodeAt(8) - 48) * 10 +
                       (timeValue.charCodeAt(9) - 48);
           const hour = (timeValue.charCodeAt(11) - 48) * 10 +
                        (timeValue.charCodeAt(12) - 48);
           const minute = (timeValue.charCodeAt(14) - 48) * 10 +
                          (timeValue.charCodeAt(15) - 48);
           const second = (timeValue.charCodeAt(17) - 48) * 10 +
                          (timeValue.charCodeAt(18) - 48);

           let ms = 0;
           let tzOffsetMs = 0;
           let i = 19;

           if (timeValue.charCodeAt(i) === 46) { // '.'
              ms = (timeValue.charCodeAt(20) - 48) * 100 +
                   (timeValue.charCodeAt(21) - 48) * 10 +
                   (timeValue.charCodeAt(22) - 48);
              i = 23;
           }

           const tzSign = timeValue.charCodeAt(i);
           if (tzSign === 43 || tzSign === 45) {
               if (timeValue.length >= i + 5 && timeValue.charCodeAt(i + 3) !== 58) {
                   const tzHour = (timeValue.charCodeAt(i + 1) - 48) * 10 +
                                  (timeValue.charCodeAt(i + 2) - 48);
                   const tzMin = (timeValue.charCodeAt(i + 3) - 48) * 10 +
                                 (timeValue.charCodeAt(i + 4) - 48);
                   tzOffsetMs = (tzHour * 60 + tzMin) * 60000;
                   let parsedTime = Date.UTC(year, month, day, hour, minute, second, ms);
                   if (tzSign === 43) parsedTime -= tzOffsetMs;
                   else if (tzSign === 45) parsedTime += tzOffsetMs;
                   return parsedTime;
               }
           }
        }
    }
    return NaN;
}

function testInline(iterations) {
    let sum = 0;
    for (let j = 0; j < iterations; j++) {
        let timeValue = str;
        let parsedTime = NaN;
        // INLINE
        if (timeValue.length >= 23 && timeValue.charCodeAt(4) === 45 && timeValue.charCodeAt(7) === 45) {
             const sep = timeValue.charCodeAt(10);
             if (sep === 84 || sep === 32) { // 'T' or ' '
                const year = (timeValue.charCodeAt(0) - 48) * 1000 +
                             (timeValue.charCodeAt(1) - 48) * 100 +
                             (timeValue.charCodeAt(2) - 48) * 10 +
                             (timeValue.charCodeAt(3) - 48);
                const month = (timeValue.charCodeAt(5) - 48) * 10 +
                              (timeValue.charCodeAt(6) - 48) - 1;
                const day = (timeValue.charCodeAt(8) - 48) * 10 +
                            (timeValue.charCodeAt(9) - 48);
                const hour = (timeValue.charCodeAt(11) - 48) * 10 +
                             (timeValue.charCodeAt(12) - 48);
                const minute = (timeValue.charCodeAt(14) - 48) * 10 +
                               (timeValue.charCodeAt(15) - 48);
                const second = (timeValue.charCodeAt(17) - 48) * 10 +
                               (timeValue.charCodeAt(18) - 48);

                let ms = 0;
                let tzOffsetMs = 0;
                let i = 19;

                if (timeValue.charCodeAt(i) === 46) { // '.'
                   ms = (timeValue.charCodeAt(20) - 48) * 100 +
                        (timeValue.charCodeAt(21) - 48) * 10 +
                        (timeValue.charCodeAt(22) - 48);
                   i = 23;
                }

                const tzSign = timeValue.charCodeAt(i);
                if (tzSign === 43 || tzSign === 45) { // '+' or '-'
                   if (timeValue.length >= i + 5 && timeValue.charCodeAt(i + 3) !== 58) { // 58 is ':'
                       const tzHour = (timeValue.charCodeAt(i + 1) - 48) * 10 +
                                      (timeValue.charCodeAt(i + 2) - 48);
                       const tzMin = (timeValue.charCodeAt(i + 3) - 48) * 10 +
                                     (timeValue.charCodeAt(i + 4) - 48);
                       tzOffsetMs = (tzHour * 60 + tzMin) * 60000;
                       parsedTime = Date.UTC(year, month, day, hour, minute, second, ms);
                       if (tzSign === 43) parsedTime -= tzOffsetMs;
                       else if (tzSign === 45) parsedTime += tzOffsetMs;
                   }
                }
             }
         }
         sum += parsedTime;
    }
    return sum;
}

function testExtracted(iterations) {
    let sum = 0;
    for (let j = 0; j < iterations; j++) {
        let parsedTime = parseDateFastPath(str);
        sum += parsedTime;
    }
    return sum;
}

// Warmup
testInline(10000);
testExtracted(10000);

const iterations = 5000000;

let start = performance.now();
testInline(iterations);
let end = performance.now();
console.log(`Inline: ${end - start} ms`);

start = performance.now();
testExtracted(iterations);
end = performance.now();
console.log(`Extracted: ${end - start} ms`);
