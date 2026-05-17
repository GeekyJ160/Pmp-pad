import { ApiConfig, BeatData } from "./types";

export async function callAI(
  prompt: string,
  cfg: ApiConfig,
  beatData: BeatData,
  fallbackBpm: number
): Promise<string | null> {
  let fullPrompt = prompt;
  if (beatData.bpm || beatData.key) {
    fullPrompt = `[Track context: BPM ${beatData.bpm || fallbackBpm}, Key ${beatData.key || 'unknown'}]. ${prompt}`;
  }

  if (cfg.provider === 'grok') {
    if (!cfg.xaiKey) throw new Error('Missing xAI API Key');
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${cfg.xaiKey}` 
      },
      body: JSON.stringify({
        model: cfg.model || 'grok-beta',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: cfg.temperature
      })
    });
    
    if (!res.ok) throw new Error(`xAI error: ${res.statusText}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
    
  } else if (cfg.provider === 'hf') {
    if (!cfg.hfKey) throw new Error('Missing HF Token');
    const res = await fetch(`https://api-inference.huggingface.co/models/${cfg.hfModel}`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${cfg.hfKey}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        inputs: fullPrompt, 
        parameters: { temperature: cfg.temperature, return_full_text: false } 
      })
    });
    
    if (!res.ok) throw new Error(`HF error: ${res.statusText}`);
    const data = await res.json();
    return data[0]?.generated_text?.trim() || data.generated_text?.trim() || null;
  }
  
  return null;
}
