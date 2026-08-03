import { authenticatedFetch } from './api';

export const modelName = "gemini-2.5-flash";

export async function chatWithAI(message: string, history: any[] = [], systemInstruction?: string) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 120000);
  
  try {
    const response = await authenticatedFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, systemInstruction }),
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
      let message = "Failed to communicate with AI server";
      try {
        const data = await response.json();
        message = data?.message || data?.error || message;
      } catch {
        // Keep generic message when server did not return JSON.
      }
      throw new Error(message);
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
  try {
    const response = await authenticatedFetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, query }),
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
      let message = "Failed to analyze data via AI server";
      try {
        const data = await response.json();
        message = data?.message || data?.error || message;
      } catch {
        // Keep generic message when server did not return JSON.
      }
      throw new Error(message);
    }
    
    return await response.json();
  } catch (err) {
    clearTimeout(id);
    console.error("analyzeData timed out or failed:", err);
    throw err;
  }
}
