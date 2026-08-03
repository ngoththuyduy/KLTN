export const modelName = "gemini-2.5-flash";

export async function chatWithAI(message: string, history: any[] = [], systemInstruction?: string) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 120000);
  
  const customKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_custom_api_key') : null;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, systemInstruction, geminiApiKey: customKey }),
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
      throw new Error("Failed to communicate with AI server");
    }
    
    return await response.json();
  } catch (err) {
    clearTimeout(id);
    console.error("chatWithAI timed out or failed:", err);
    throw err;
  }
}

export async function analyzeData(data: any, query: string) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 120000);
  const customKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_custom_api_key') : null;

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, query, geminiApiKey: customKey }),
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
      throw new Error("Failed to analyze data via AI server");
    }
    
    return await response.json();
  } catch (err) {
    clearTimeout(id);
    console.error("analyzeData timed out or failed:", err);
    throw err;
  }
}
