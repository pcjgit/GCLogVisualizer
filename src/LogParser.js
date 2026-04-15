export function parseLogFile(fileContent) {
  const lines = fileContent.split('\n');
  const data = [];

  // Matches 738M->674M(5928M) or 10.5M->2M(100M) handling different units
  const memoryRegex = /(\d+(?:\.\d+)?)([KMGkmg]?)->(\d+(?:\.\d+)?)([KMGkmg]?)\((\d+(?:\.\d+)?)([KMGkmg]?)\)/;
  
  // Matches first bracket group, e.g. [2026-04-15T10:27:57.630+0000] or [1.234s]
  const timeRegex = /^\[([^\]]+)\]/;

  lines.forEach((line) => {
    const memoryMatch = line.match(memoryRegex);
    if (!memoryMatch) return;

    const timeMatch = line.match(timeRegex);
    if (!timeMatch) return;

    let timeValue = timeMatch[1];
    let timeLabel = timeValue;
    // Check if relative time like "10.23s"
    if (timeValue.endsWith('s') && !isNaN(parseFloat(timeValue))) {
       timeValue = parseFloat(timeValue);
       timeLabel = `${timeValue}s`;
    } else {
       // Try parsing as date
       const d = new Date(timeValue);
       if (!isNaN(d.getTime())) {
          timeValue = d.getTime();
          timeLabel = d.toLocaleTimeString(); // More readable for charts
       }
    }

    const beforeVal = parseFloat(memoryMatch[1]);
    const beforeUnit = memoryMatch[2].toUpperCase();
    
    const afterVal = parseFloat(memoryMatch[3]);
    const afterUnit = memoryMatch[4].toUpperCase();

    // Normalize to Megabytes
    const normalize = (val, unit) => {
      if (unit === 'K') return val / 1024;
      if (unit === 'G') return val * 1024;
      return val; // Assume M by default or no unit
    };

    const beforeMB = normalize(beforeVal, beforeUnit);
    const afterMB = normalize(afterVal, afterUnit);

    data.push({
      rawTime: timeMatch[1],
      timeValue,
      timeLabel,
      beforeGC: parseFloat(beforeMB.toFixed(2)),
      afterGC: parseFloat(afterMB.toFixed(2))
    });
  });

  return data;
}
