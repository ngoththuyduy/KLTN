export function recursiveSplit(
  text: string,
  separators: string[] = ["\n\n", "\n", " ", ""],
  chunkSize = 500,
  chunkOverlap = 50
): string[] {
  const result: string[] = [];
  
  function split(txt: string, separatorIndex: number) {
    txt = txt.trim();
    if (txt.length <= chunkSize) {
      if (txt.length > 0) {
        result.push(txt);
      }
      return;
    }
    
    if (separatorIndex >= separators.length) {
      // Fallback: hard split by chunk size with overlap
      let i = 0;
      while (i < txt.length) {
        const chunk = txt.substring(i, i + chunkSize);
        if (chunk.length > 0) {
          result.push(chunk);
        }
        i += (chunkSize - chunkOverlap);
      }
      return;
    }
    
    const separator = separators[separatorIndex];
    const parts = txt.split(separator);
    
    let currentChunk = "";
    
    for (const part of parts) {
      const partWithSep = currentChunk ? (separator + part) : part;
      
      if ((currentChunk + partWithSep).length <= chunkSize) {
        currentChunk += partWithSep;
      } else {
        if (currentChunk) {
          result.push(currentChunk);
          // Keep trailing overlapping part
          const overlapStart = Math.max(0, currentChunk.length - chunkOverlap);
          currentChunk = currentChunk.substring(overlapStart) + separator + part;
        } else {
          // A single part is too large, split it with next separator
          split(part, separatorIndex + 1);
        }
      }
    }
    
    if (currentChunk && currentChunk.trim()) {
      result.push(currentChunk.trim());
    }
  }
  
  split(text, 0);
  return result;
}

export function convertRowsToText(rows: any[], startRowNumber: number = 2): string {
  if (!rows || rows.length === 0) return "";
  return rows.map((row, idx) => {
    const excelRow = startRowNumber + idx;
    const detail = Object.entries(row)
      .filter(([k]) => k !== 'fileId' && k !== 'id' && !k.startsWith('_'))
      .map(([k, v]) => `Cột "${k}": ${v}`)
      .join(', ');
    return `[Dòng Excel ${excelRow}] ${detail}`;
  }).join("\n");
}
