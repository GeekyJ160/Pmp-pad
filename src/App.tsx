/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Settings, Mic, Upload, PlayCircle, Loader2 } from 'lucide-react';
import { Storage, ApiConfig, BeatData } from './lib/types';
import { analyzeAudioBuffer } from './lib/audioAnalysis';
import { callAI } from './lib/ai';

const estimateSyllables = (word: string) => {
  const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (!clean) return 1;
  if (clean.length <= 3) return 1;
  const vowelGroups = clean.match(/[aeiouy]+/g);
  return vowelGroups ? vowelGroups.length : 1;
};

// NOTE: Client-side AI Keys
// This application uses `fetch` from the browser directly to external AI providers 
// as specified in the original manual requirements. 
// Keys are stored locally in the browser's localStorage.

export default function App() {
  const [lyrics, setLyrics] = useState(() => Storage.get('lyrics', ''));
  const [bpm, setBpm] = useState(() => Storage.get('bpm', 128));
  const [beatData, setBeatData] = useState<BeatData>({ bpm: null, key: null, chord: null });
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => Storage.get('apiConfig', {
    provider: 'grok',
    model: 'grok-beta',
    hfModel: 'mistralai/Mistral-7B-Instruct-v0.3',
    xaiKey: '',
    hfKey: '',
    temperature: 0.85
  }));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Analysis State
  const [flowScore, setFlowScore] = useState<string>('—');
  const [heatmapColors, setHeatmapColors] = useState<string[]>([]);

  useEffect(() => {
    Storage.set('lyrics', lyrics);
    updateLyricsAnalysis(lyrics);
  }, [lyrics]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  };

  const updateLyricsAnalysis = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setFlowScore('—');
      setHeatmapColors([]);
      return;
    }
    const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
    let totalSyllables = 0;
    const colors: string[] = [];

    lines.forEach(line => {
      const words = line.split(/\s+/);
      const count = words.reduce((acc, w) => acc + estimateSyllables(w), 0);
      totalSyllables += count;
      const density = Math.min(1, count / Math.max(1, words.length));
      if (density > 0.8) colors.push('#22c55e'); // Green
      else if (density > 0.5) colors.push('#f59e0b'); // Gold
      else colors.push('#ef4444'); // Red
    });

    const avg = lines.length ? (totalSyllables / lines.length).toFixed(1) : '0';
    setFlowScore(avg);
    setHeatmapColors(colors);
  };

  const handleBeatFile = async (file: File) => {
    if (!file) return;
    setIsAnalyzing(true);
    showToast('Analyzing beat...');
    
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await audioCtx.decodeAudioData(arrayBuffer);
      const result = await analyzeAudioBuffer(buffer);
      setBeatData(result);
      showToast(`Detected: ${result.bpm} BPM, ${result.key}`);
    } catch (err) {
      showToast('Audio analysis failed. Try a different file.');
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleRecording = async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];
        
        mediaRecorder.ondataavailable = e => audioChunksRef.current.push(e.data);
        mediaRecorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          showToast('Recording saved (Check console URL)');
          console.log('Recording URL:', url);
        };
        
        mediaRecorder.start();
        setIsRecording(true);
        showToast('Recording...');
      } catch (err) {
        showToast('Microphone access denied.');
        console.error(err);
      }
    } else {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      showToast('Recording stopped.');
    }
  };

  const handleAiCall = async (prompt: string, transformMode: 'append' | 'replace' | 'continue') => {
    setIsProcessingAI(true);
    showToast('Forging lyrics...');
    try {
      const res = await callAI(prompt, apiConfig, beatData, bpm);
      if (res) {
        if (transformMode === 'replace') {
          setLyrics(res);
        } else {
          setLyrics(prev => prev ? prev + '\n' + res : res);
        }
      } else {
        showToast('Failed to generate lyrics.');
      }
    } catch (e: any) {
      showToast(e.message || 'Error occurred calling AI');
    } finally {
      setIsProcessingAI(false);
    }
  };

  return (
    <div className="relative min-h-screen">
      {/* TOPBAR */}
      <div className="h-16 bg-app-card/95 border-b border-[#2a2a3e] flex items-center px-5 gap-4 sticky top-0 z-40 backdrop-blur-md">
        <div className="logo-text font-mono text-[22px] font-extrabold tracking-tight">DIPP PRO</div>
        <div className="text-[#777] text-[13px]">RhymeForge v3.7</div>
        <button 
          onClick={() => setIsSettingsOpen(true)}
          className="ml-auto bg-app-purple text-white px-4 py-2 rounded-full cursor-pointer flex items-center gap-2 hover:bg-purple-500 transition"
        >
          <Settings size={16} /> <span className="text-sm font-medium">Settings</span>
        </button>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr_360px] gap-5 p-5 max-w-[1400px] mx-auto">
        
        {/* LEFT: LYRICS */}
        <div className="bg-app-card rounded-[24px] border border-[#2a2a3e] p-5 flex flex-col gap-4">
          <h3 className="text-app-gold font-bold flex items-center gap-2">
            📝 LYRICS
          </h3>
          <textarea
            value={lyrics}
            onChange={e => setLyrics(e.target.value)}
            placeholder="Write or generate bars...&#10;Example: Rhyme schemes ignite, multi-syllable light..."
            className="flex-1 bg-[#0f0f17] border border-[#3b3b5c] rounded-2xl p-4 text-[#e0e0ff] font-mono text-[15.5px] leading-relaxed resize-none focus:outline-none focus:border-app-purple min-h-[250px] transition-colors"
          />
          <div className="text-center">
            <div className="text-[13px] text-[#777]">Flow Score</div>
            <div className="text-[42px] font-extrabold text-app-cyan">{flowScore}</div>
          </div>
          <div className="flex gap-1 flex-wrap mt-2">
            {heatmapColors.map((color, i) => (
              <span key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }}></span>
            ))}
          </div>
        </div>

        {/* CENTER PANEL */}
        <div className="bg-app-card rounded-[32px] border border-[#2a2a3e] p-8 flex flex-col items-center gap-6">
          <button
            onClick={toggleRecording}
            className={`mic-circle w-[240px] h-[240px] rounded-full flex items-center justify-center cursor-pointer ${isRecording ? 'recording' : ''}`}
          >
            <Mic size={90} className={isRecording ? 'text-red-400' : 'text-app-gold'} strokeWidth={1.8} />
          </button>

          <div className="flex items-center gap-1.5 w-[90%] h-[70px]">
            <div className={`waveform-bar ${!isRecording ? 'animate-none scale-y-[0.2]' : ''}`}></div>
            <div className={`waveform-bar ${!isRecording ? 'animate-none scale-y-[0.3]' : ''}`}></div>
            <div className={`waveform-bar ${!isRecording ? 'animate-none scale-y-[0.5]' : ''}`}></div>
            <div className={`waveform-bar ${!isRecording ? 'animate-none scale-y-[0.3]' : ''}`}></div>
            <div className={`waveform-bar ${!isRecording ? 'animate-none scale-y-[0.2]' : ''}`}></div>
          </div>

          {/* BEAT ANALYZER */}
          <div className="bg-[#1a1a24] rounded-2xl p-5 border border-[#3b3b5c] w-full mt-auto">
            <div className="flex justify-between items-center mb-3">
              <strong className="text-app-gold flex items-center gap-2"><PlayCircle size={18}/> Beat Analyzer</strong>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-app-purple/15 border border-app-purple text-white px-3 py-1.5 rounded-xl hover:bg-app-purple transition text-sm flex items-center gap-2"
                disabled={isAnalyzing}
              >
                {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16}/>}
                <span>Upload Beat</span>
              </button>
            </div>

            <div 
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleBeatFile(file);
              }}
              onDragOver={e => e.preventDefault()}
              className="border-2 border-dashed border-app-purple/50 rounded-xl p-5 text-center cursor-pointer hover:bg-app-purple/10 transition-colors text-sm text-gray-400"
            >
              Drop audio file here (WAV, MP3)
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              accept="audio/*" 
              className="hidden" 
              onChange={e => e.target.files?.[0] && handleBeatFile(e.target.files[0])} 
            />

            {beatData.bpm && (
              <div className="mt-4 bg-[#0f0f17] p-4 rounded-xl">
                <div className="flex gap-5 flex-wrap">
                  <div><strong>BPM:</strong> <span className="text-app-gold font-bold ml-1">{beatData.bpm}</span></div>
                  <div><strong>Key:</strong> <span className="text-app-cyan font-bold ml-1">{beatData.key}</span></div>
                  <div><strong>Chord:</strong> <span className="text-purple-400 font-bold ml-1">{beatData.chord}</span></div>
                </div>
                <div className="flex gap-2 flex-wrap mt-3">
                  <span className="px-3 py-1 bg-app-purple/15 border border-app-purple rounded-full text-[13px] text-purple-300">
                    {beatData.chord}
                  </span>
                </div>
                <button 
                  onClick={() => {
                    setBpm(beatData.bpm!);
                    Storage.set('bpm', beatData.bpm);
                    showToast(`Applied BPM: ${beatData.bpm}`);
                  }}
                  className="mt-3 bg-app-purple/15 border border-app-purple text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-app-purple transition w-full"
                >
                  Apply BPM + Key to Project
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: AI FORGE */}
        <div className="bg-app-card rounded-[24px] border border-[#2a2a3e] p-5 flex flex-col gap-4">
          <h3 className="text-app-purple font-bold flex items-center justify-between">
            🔥 AI FORGE 
            <span className="text-[12px] text-gray-500 font-normal leading-none">(Context-aware)</span>
          </h3>
          
          <button 
            disabled={isProcessingAI}
            onClick={() => handleAiCall('Write an 8-bar rap verse with complex multi-syllable rhymes and internal patterns. Return only the verse.', 'append')}
            className="w-full p-3.5 bg-app-purple/15 border border-app-purple text-white rounded-xl font-medium hover:bg-app-purple hover:translate-x-1 transition-all disabled:opacity-50"
          >
            Generate 8-Bar Verse
          </button>
          
          <button 
            disabled={isProcessingAI}
            onClick={() => {
              if(!lyrics.trim()) return showToast('Add some lyrics first.');
              const lastLine = lyrics.split('\n').filter(l => l.trim()).pop();
              handleAiCall(`Continue this rap line with 4 more bars in the same style: "${lastLine}"`, 'continue');
            }}
            className="w-full p-3.5 bg-app-purple/15 border border-app-purple text-white rounded-xl font-medium hover:bg-app-purple hover:translate-x-1 transition-all disabled:opacity-50"
          >
            Continue Last Line
          </button>
          
          <button 
            disabled={isProcessingAI}
            onClick={() => handleAiCall(`Rewrite the following rap lyrics to use heavier multi-syllable rhymes: "${lyrics || 'I walked down the block'}"`, 'replace')}
            className="w-full p-3.5 bg-app-purple/15 border border-app-purple text-white rounded-xl font-medium hover:bg-app-purple hover:translate-x-1 transition-all disabled:opacity-50"
          >
            Rewrite for Heavy Multis
          </button>
          
          <button 
            disabled={isProcessingAI}
            onClick={() => handleAiCall('Create a catchy 4-line rap hook with internal rhymes and a memorable phrase.', 'append')}
            className="w-full p-3.5 bg-app-purple/15 border border-app-purple text-white rounded-xl font-medium hover:bg-app-purple hover:translate-x-1 transition-all disabled:opacity-50"
          >
            Generate Hook
          </button>
          
          <button 
            disabled={isProcessingAI}
            onClick={() => {
              if (!beatData.bpm) showToast('Analyze a beat first for better results.');
              handleAiCall('Generate a 4-bar punch-in verse matching the current beat energy.', 'append');
            }}
            className="w-full p-3.5 bg-red-500/20 border border-red-500 text-white rounded-xl font-medium hover:bg-red-500 hover:translate-x-1 transition-all mt-auto disabled:opacity-50"
          >
            ⏱️ Punch-In
          </button>
        </div>
      </div>

      {/* TOAST */}
      <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#1f1f2e] text-purple-400 px-8 py-3.5 rounded-full font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.6)] z-[10000] transition-opacity duration-300 pointer-events-none ${toastMsg ? 'opacity-100' : 'opacity-0'}`}>
        {toastMsg}
      </div>

      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/95 z-[30000] flex items-center justify-center p-4">
          <div className="bg-[#111118] p-8 rounded-3xl w-full max-w-[520px] border-2 border-app-purple max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Settings size={20}/> Settings</h2>
            
            <label className="text-sm text-gray-400 block mt-4 mb-2">Provider</label>
            <select 
              value={apiConfig.provider}
              onChange={e => setApiConfig({...apiConfig, provider: e.target.value as 'grok'|'hf'})}
              className="w-full p-3 bg-[#1a1a24] border border-[#4c1d95] rounded-xl text-white outline-none"
            >
              <option value="grok">Grok (xAI)</option>
              <option value="hf">Hugging Face</option>
            </select>

            <label className="text-sm text-gray-400 block mt-4 mb-2">Model</label>
            <select 
              value={apiConfig.provider === 'grok' ? apiConfig.model : apiConfig.hfModel}
              onChange={e => {
                if (apiConfig.provider === 'grok') setApiConfig({...apiConfig, model: e.target.value});
                else setApiConfig({...apiConfig, hfModel: e.target.value});
              }}
              className="w-full p-3 bg-[#1a1a24] border border-[#4c1d95] rounded-xl text-white outline-none"
            >
              {apiConfig.provider === 'grok' ? (
                <>
                  <option value="grok-beta">grok-beta</option>
                  <option value="grok-3">grok-3</option>
                  <option value="grok-2">grok-2</option>
                </>
              ) : (
                <>
                  <option value="mistralai/Mistral-7B-Instruct-v0.3">Mistral 7B</option>
                  <option value="meta-llama/Llama-3.2-3B-Instruct">Llama 3.2 3B</option>
                  <option value="google/gemma-7b-it">Gemma 7B IT</option>
                </>
              )}
            </select>

            <label className="text-sm text-gray-400 block mt-4 mb-2 flex justify-between">
              <span>Temperature</span>
              <span>{apiConfig.temperature}</span>
            </label>
            <input 
              type="range" 
              min="0" max="1.5" step="0.05" 
              value={apiConfig.temperature}
              onChange={e => setApiConfig({...apiConfig, temperature: parseFloat(e.target.value)})}
              className="w-full mb-2"
            />

            {apiConfig.provider === 'grok' && (
              <input 
                type="password" 
                placeholder="xAI API Key" 
                value={apiConfig.xaiKey}
                onChange={e => setApiConfig({...apiConfig, xaiKey: e.target.value})}
                className="w-full p-3 bg-[#1a1a24] border border-[#4c1d95] rounded-xl text-white mt-4 outline-none"
              />
            )}

            {apiConfig.provider === 'hf' && (
              <input 
                type="password" 
                placeholder="Hugging Face Token" 
                value={apiConfig.hfKey}
                onChange={e => setApiConfig({...apiConfig, hfKey: e.target.value})}
                className="w-full p-3 bg-[#1a1a24] border border-[#4c1d95] rounded-xl text-white mt-4 outline-none"
              />
            )}

            <button 
              onClick={() => {
                Storage.set('apiConfig', apiConfig);
                setIsSettingsOpen(false);
                showToast('Settings saved ✅');
              }}
              className="w-full p-3.5 bg-app-purple border-none rounded-xl mt-6 text-white font-bold cursor-pointer hover:bg-purple-500 transition"
            >
              Save Settings
            </button>
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="w-full mt-2 p-3 bg-transparent border border-gray-600 text-gray-400 rounded-xl cursor-pointer hover:bg-gray-800 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

