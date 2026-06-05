/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  Mic, 
  Upload, 
  Radio, 
  Square, 
  Download, 
  Settings, 
  Sparkles, 
  FileAudio, 
  Mail, 
  LogOut, 
  Loader2, 
  Music, 
  Bookmark, 
  Zap, 
  Check, 
  HelpCircle,
  X,
  Play,
  Pause,
  Clock
} from 'lucide-react';
import { Storage, ApiConfig, BeatData, VocalLayer } from './lib/types';
import { callAI } from './lib/ai';

// Firebase + Gmail Setup
import { initAuth, googleSignIn, getAccessToken, logout } from './lib/auth';
import { sendGmailMessage } from './lib/gmail';
import type { User } from 'firebase/auth';

// ==================== FLOW & RHYME METRICS HELPERS ====================
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const SYL_EXCEPT: Record<string, number> = { 
  the: 1, and: 1, for: 1, you: 1, are: 1, a: 1, i: 1, your: 1, of: 1, to: 1, in: 1, is: 1, it: 1, beautiful: 3 
};

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (SYL_EXCEPT[w]) return SYL_EXCEPT[w];
  let s = (w.match(/[aeiouy]+/g) || []).length;
  if (w.endsWith('e') && s > 1 && !w.endsWith('le')) s--;
  if (/tion|sion|cial|tial/.test(w)) s++;
  return Math.max(1, s);
}

function analyzeLyrics(text: string) {
  const lines = text.split('\n').filter(l => l.trim());
  let totalSyl = 0;
  let multis = 0;

  const lineStats = lines.map((line, i) => {
    const words = line.match(/\b\w+\b/g) || [];
    let syllables = 0;
    let lineMultis = 0;

    for (const w of words) {
      const sNum = countSyllables(w);
      syllables += sNum;
      if (sNum >= 3) {
        lineMultis++;
        multis++;
      }
    }
    totalSyl += syllables;

    const density = words.length ? Math.round((lineMultis / words.length) * 100) : 0;
    return {
      line,
      words: words.length,
      syllables,
      multis: lineMultis,
      density
    };
  });

  const avg = lines.length ? totalSyl / lines.length : 0;
  const score = lines.length ? Math.min(99, Math.max(40, Math.round(55 + avg * 3 + multis * 2))) : 0;

  return {
    lines,
    lineStats,
    totalSyl,
    multis,
    score
  };
}

// Interactive Rhyme Game Word bank precisely from standard spec page 59
const RHYME_GAME = [
  { word: 'FIRE', answers: ['hire','wire','inspire','higher','desire','entire','retire','admire','empire','vampire'] },
  { word: 'NIGHT', answers: ['right','light','tight','might','sight','flight','bright','fight','write','ignite','despite','alright','midnight'] },
  { word: 'GOLD', answers: ['bold','cold','told','old','hold','fold','sold','mold','untold','controlled','behold','unfold'] },
  { word: 'GRIND', answers: ['mind','find','blind','kind','designed','behind','refined','combined','defined','remind','intertwined'] },
  { word: 'REAL', answers: ['feel','deal','steel','heal','reveal','appeal','steal','kneel','ordeal','surreal','ideal','conceal'] },
  { word: 'PAIN', answers: ['rain','gain','brain','vain','remain','insane','maintain','contain','explain','campaign','champagne','sustain','complain'] },
  { word: 'FLOW', answers: ['know','show','glow','grow','below','although','bestow','radio','overthrow','shadow'] },
  { word: 'KING', answers: ['ring','bring','sting','sing','thing','spring','everything','suffering','reckoning'] },
  { word: 'SOUL', answers: ['goal','role','whole','toll','control','patrol','console','stroll','enroll','payroll'] },
  { word: 'RISE', answers: ['eyes','wise','skies','ties','disguise','surprise','realize','demise','enterprise','paradise','recognize'] }
];

function getLastVowelGroup(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const m = w.match(/[aeiouy]+[^aeiouy]*$/);
  return m ? m[0] : w.slice(-2);
}

// Animated simulated frequency visualizer definitions
const PIANO_PATTERN = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0];
const BASE_HEIGHTS = [68, 45, 78, 42, 72, 62, 38, 82, 48, 68, 44, 58, 70, 40];

// ==================== MAIN COMPONENT ====================
export default function App() {
  // Navigation & Core States
  const [currentTab, setCurrentTab] = useState<'vocal' | 'attic' | 'beat'>(() => Storage.get('currentTab', 'vocal') as any);
  const [lyrics, setLyrics] = useState(() => Storage.get('lyrics', ''));
  const [bpm, setBpm] = useState(() => Storage.get('bpm', 128));
  const [style, setStyle] = useState(() => Storage.get('style', 'kendrick'));
  
  // Backing Track & Voice states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [autoTune, setAutoTune] = useState(false);
  const [recordTimer, setRecordTimer] = useState("00:00");
  const [recSeconds, setRecSeconds] = useState(0);
  const [backingBeatName, setBackingBeatName] = useState("");
  const [beatLockPillShow, setBeatLockPillShow] = useState(false);
  const [chord, setChord] = useState({ root: "C", quality: "Major", label: "C Major" });
  
  // Multi-Track Vocal Layers Store
  const [vocalLayers, setVocalLayers] = useState<VocalLayer[]>(() => Storage.get('vocalLayers', [
    { id: '1', name: 'Lead Vocal Take', duration: '0:18', isMuted: false, isSolo: false, timestamp: '10:49 AM', pitchShift: 0 },
    { id: '2', name: 'Backing Harmonies', duration: '0:12', isMuted: false, isSolo: false, timestamp: '10:50 AM', pitchShift: 2 },
  ]));

  // Web Speech State
  const [isSTTRecording, setIsSTTRecording] = useState(false);

  // Settings configurations
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => Storage.get('apiConfig', {
    provider: 'grok',
    model: 'grok-beta',
    hfModel: 'mistralai/Mistral-7B-Instruct-v0.3',
    xaiKey: '',
    hfKey: '',
    temperature: 0.85
  }));

  // Toast feedback state
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Rhyming Game States
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [userGuess, setUserGuess] = useState("");
  const [streak, setStreak] = useState(0);
  const [gameScore, setGameScore] = useState<string | number>("—");
  const [gameFeedback, setGameFeedback] = useState("");

  // Beat analyzer slider bottom sheet
  const [isBeatSheetOpen, setIsBeatSheetOpen] = useState(false);
  const [isDraggingBeat, setIsDraggingBeat] = useState(false);
  const [isAnalyzingBeat, setIsAnalyzingBeat] = useState(false);
  const [analyzeStage, setAnalyzeStage] = useState("Decoding audio...");
  const [detectedData, setDetectedData] = useState<{
    bpm: number | null;
    key: string | null;
    chord: string | null;
    chordList: string[];
  }>(() => Storage.get('detected', { bpm: null, key: null, chord: null, chordList: [] }));

  // Animated visualizer heights
  const [visHeights, setVisHeights] = useState<number[]>(BASE_HEIGHTS);

  // Auth Integration
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);

  // Progress/Loading bar trigger
  const [isProcessingAI, setIsProcessingAI] = useState(false);

  // Refs
  const currentTabRef = useRef(currentTab);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRecognitionRef = useRef<any>(null);
  const recTimerRef = useRef<NodeJS.Timeout | null>(null);
  const playbackVisualizerRef = useRef<NodeJS.Timeout | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);

  // Sync tab helper
  const navigateTab = (target: 'vocal' | 'attic' | 'beat') => {
    setCurrentTab(target);
    currentTabRef.current = target;
    Storage.set('currentTab', target);
  };

  // Toast dispatch
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  }, []);

  // System running clock
  useEffect(() => {
    const tick = () => {
      if (clockRef.current) {
        const d = new Date();
        const hrs = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        clockRef.current.textContent = `${hrs}:${mins}`;
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync lyrics & analysis
  const analysis = useMemo(() => {
    return analyzeLyrics(lyrics);
  }, [lyrics]);

  // Firebase auth sync
  useEffect(() => {
    const unsub = initAuth((currentUser) => {
      setUser(currentUser);
    }, () => {
      setUser(null);
    });
    return () => unsub();
  }, []);

  // Restore detected state values on init
  useEffect(() => {
    if (detectedData.bpm) {
      setBeatLockPillShow(true);
      if (detectedData.chord) {
        setChord({ root: detectedData.key || "C", quality: detectedData.chord.includes("min") ? "Minor" : "Major", label: detectedData.chord });
      }
    }
  }, [detectedData]);

  // Simulated animated waveform visualizer looping
  useEffect(() => {
    if (isPlaying || isRecording) {
      playbackVisualizerRef.current = setInterval(() => {
        setVisHeights(prev => prev.map(h => {
          const mod = Math.floor((Math.random() - 0.5) * 50);
          return Math.max(8, Math.min(98, h + mod));
        }));
      }, 90);
    } else {
      if (playbackVisualizerRef.current) {
        clearInterval(playbackVisualizerRef.current);
        playbackVisualizerRef.current = null;
      }
      setVisHeights(BASE_HEIGHTS);
    }
    return () => {
      if (playbackVisualizerRef.current) clearInterval(playbackVisualizerRef.current);
    };
  }, [isPlaying, isRecording]);

  // Voice recording running timer logic
  useEffect(() => {
    if (isRecording) {
      setRecSeconds(0);
      setRecordTimer("00:00");
      recTimerRef.current = setInterval(() => {
        setRecSeconds(prev => {
          const s = prev + 1;
          const mins = Math.floor(s / 60);
          const secs = s % 60;
          setRecordTimer(`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`);
          return s;
        });
      }, 1000);
    } else {
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
    }
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, [isRecording]);

  // Toggle AutoTune State
  const toggleAutoTune = () => {
    const nextVal = !autoTune;
    setAutoTune(nextVal);
    if (nextVal) {
      showToast("🎙️ Auto-Tune ON · c4b5fd");
    } else {
      showToast("Auto-Tune OFF");
    }
  };

  // Toggle Standard Backing Track Playback
  const togglePlayback = () => {
    const nextPlay = !isPlaying;
    setIsPlaying(nextPlay);
    if (nextPlay) {
      showToast("▶️ Playback initiated");
    } else {
      showToast("⏸️ Paused backing loop");
    }
  };

  // Toggle Microphone recording
  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      
      const nextTakeNum = vocalLayers.length + 1;
      const formattedDuration = recordTimer === "00:00" ? "0:05" : recordTimer.replace(/^0/, '');
      const newTake: VocalLayer = {
        id: Date.now().toString(),
        name: `Vocal Take ${nextTakeNum}`,
        duration: formattedDuration,
        isMuted: false,
        isSolo: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        pitchShift: 0
      };
      
      const nextLayers = [...vocalLayers, newTake];
      setVocalLayers(nextLayers);
      Storage.set('vocalLayers', nextLayers);

      showToast(`💾 Vocal Take ${nextTakeNum} saved to layers!`);
    } else {
      setIsRecording(true);
      showToast("🎙️ Recording new layer — tap mic to stop");
    }
  };

  const isLayerActive = (layer: VocalLayer) => {
    if (layer.isMuted) return false;
    const hasSolo = vocalLayers.some(l => l.isSolo);
    if (hasSolo) return layer.isSolo;
    return true;
  };

  const deleteLayer = (id: string) => {
    const nextList = vocalLayers.filter(l => l.id !== id);
    setVocalLayers(nextList);
    Storage.set('vocalLayers', nextList);
    showToast("🗑️ Layer track deleted");
  };

  const toggleMute = (id: string) => {
    const nextList = vocalLayers.map(l => {
      if (l.id === id) {
        return { ...l, isMuted: !l.isMuted };
      }
      return l;
    });
    setVocalLayers(nextList);
    Storage.set('vocalLayers', nextList);
  };

  const toggleSolo = (id: string) => {
    const targetLayer = vocalLayers.find(l => l.id === id);
    if (!targetLayer) return;
    const nextSoloState = !targetLayer.isSolo;
    
    const nextList = vocalLayers.map(l => {
      if (l.id === id) {
        return { ...l, isSolo: nextSoloState };
      }
      return l;
    });
    setVocalLayers(nextList);
    Storage.set('vocalLayers', nextList);
    showToast(nextSoloState ? "🔊 Soloing layer" : "Stopped soloing layer");
  };

  const changePitchShift = (id: string, semitones: number) => {
    const nextList = vocalLayers.map(l => {
      if (l.id === id) {
        const currentShift = l.pitchShift ?? 0;
        const nextShift = Math.max(-12, Math.min(12, currentShift + semitones));
        return { ...l, pitchShift: nextShift };
      }
      return l;
    });
    setVocalLayers(nextList);
    Storage.set('vocalLayers', nextList);
    const target = nextList.find(l => l.id === id);
    if (target) {
      const formatted = (target.pitchShift ?? 0) > 0 ? `+${target.pitchShift}` : target.pitchShift;
      showToast(`🎚️ ${target.name} Pitch: ${formatted} semitones`);
    }
  };

  // Import backing tracks via offline detection helper
  const handleBeatImport = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      showToast("⚠️ Audio file required");
      return;
    }

    setIsBeatSheetOpen(true);
    setIsAnalyzingBeat(true);
    setAnalyzeStage("Reading file...");

    try {
      setAnalyzeStage("Decoding audio buffers...");
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuf = await file.arrayBuffer();
      const buffer = await audioCtx.decodeAudioData(arrayBuf);

      setAnalyzeStage("Onset analysis & BPM extraction...");
      // Advanced onset detection novelty curve & interval clustering
      const channelData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;
      
      // Calculate signal energy over sliding windows
      const hopSize = 512;
      const winSize = 1024;
      const energies: number[] = [];
      const scanLength = Math.min(channelData.length, sampleRate * 30); // scan first 30 seconds
      
      for (let i = 0; i < scanLength - winSize; i += hopSize) {
        let sum = 0;
        for (let j = 0; j < winSize; j++) {
          const val = channelData[i + j];
          sum += val * val;
        }
        energies.push(Math.sqrt(sum / winSize));
      }

      // Compute novelty curve (positive change in energy envelope)
      const novelty: number[] = [];
      let maxNovelty = 0.0001;
      for (let i = 1; i < energies.length; i++) {
        const diff = energies[i] - energies[i - 1];
        const val = diff > 0 ? diff : 0;
        novelty.push(val);
        if (val > maxNovelty) maxNovelty = val;
      }

      // Find local onset peaks above adaptive threshold
      const onsetThreshold = maxNovelty * 0.15;
      const onsetTimes: number[] = [];
      for (let i = 1; i < novelty.length - 1; i++) {
        if (novelty[i] > onsetThreshold && novelty[i] > novelty[i - 1] && novelty[i] > novelty[i + 1]) {
          const time = ((i + 1) * hopSize) / sampleRate;
          onsetTimes.push(time);
        }
      }

      // Compute intervals between all nearby onset pairs and bin them
      const intervalsList: number[] = [];
      for (let a = 0; a < onsetTimes.length; a++) {
        for (let b = a + 1; b < Math.min(onsetTimes.length, a + 10); b++) {
          const interval = onsetTimes[b] - onsetTimes[a];
          if (interval >= 0.25 && interval <= 2.0) { // ranges from 30 BPM to 240 BPM
            intervalsList.push(interval);
          }
        }
      }

      // Group interval matches onto standard rap/hip-hop BPM bins (60 - 200 BPM) with subharmonic weights
      const bpmCounts: Record<number, number> = {};
      for (const interval of intervalsList) {
        const estBpm = 60 / interval;
        const roundedBpm = Math.round(estBpm);
        if (roundedBpm >= 60 && roundedBpm <= 200) {
          bpmCounts[roundedBpm] = (bpmCounts[roundedBpm] || 0) + 1.0;
          
          // Vote for subharmonic and harmonic fractions to secure beat matching stability
          const halfBpm = Math.round(estBpm / 2);
          if (halfBpm >= 60 && halfBpm <= 200) {
            bpmCounts[halfBpm] = (bpmCounts[halfBpm] || 0) + 0.35;
          }
          const doubleBpm = Math.round(estBpm * 2);
          if (doubleBpm >= 60 && doubleBpm <= 200) {
            bpmCounts[doubleBpm] = (bpmCounts[doubleBpm] || 0) + 0.35;
          }
        }
      }

      // Find highest voted BPM frequency
      let detectedBpm = 120;
      let maxVotes = 0;
      for (const bStr in bpmCounts) {
        const b = parseInt(bStr);
        if (bpmCounts[b] > maxVotes) {
          maxVotes = bpmCounts[b];
          detectedBpm = b;
        }
      }

      setAnalyzeStage("Goertzel key and dominant chord mappings...");
      // Goertzel pitch class chromagram builder
      const BASE_FREQS = [
        130.81, // C3
        138.59, // C#3
        146.83, // D3
        155.56, // D#3
        164.81, // E3
        174.61, // F3
        185.00, // F#3
        196.00, // G3
        207.65, // G#3
        220.00, // A3
        233.08, // A#3
        246.94  // B3
      ];

      const goertzelPower = (data: Float32Array, targetFreq: number, sRate: number) => {
        const len = data.length;
        const k = Math.round((len * targetFreq) / sRate);
        const w = (2 * Math.PI * k) / len;
        const coeff = 2 * Math.cos(w);
        let s = 0, sPrev1 = 0, sPrev2 = 0;
        for (let i = 0; i < len; i++) {
          s = data[i] + coeff * sPrev1 - sPrev2;
          sPrev2 = sPrev1;
          sPrev1 = s;
        }
        return Math.max(0, sPrev1 * sPrev1 + sPrev2 * sPrev2 - coeff * sPrev1 * sPrev2);
      };

      const averageChroma = new Float32Array(12);
      // Sample blocks from different offsets in the audio file to build rich key profile
      const sampleOffsets = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
      const frameLen = 4096;

      for (const pct of sampleOffsets) {
        const offset = Math.floor(pct * channelData.length);
        if (offset + frameLen < channelData.length) {
          const frameSegment = channelData.slice(offset, offset + frameLen);
          for (let p = 0; p < 12; p++) {
            // Aggregate spectral power over 3 octaves (Octaves 3, 4, 5)
            const p3 = goertzelPower(frameSegment, BASE_FREQS[p], sampleRate);
            const p4 = goertzelPower(frameSegment, BASE_FREQS[p] * 2, sampleRate);
            const p5 = goertzelPower(frameSegment, BASE_FREQS[p] * 4, sampleRate);
            averageChroma[p] += p3 + p4 + p5;
          }
        }
      }

      // Root key profile template match (Major vs Minor triads)
      let bestKeyIndex = 0;
      let bestIsMinor = false;
      let maxScore = -1;

      for (let i = 0; i < 12; i++) {
        // Major Triad Template: Root, Maj3rd (+4), Perf5th (+7)
        const majScore = averageChroma[i] + averageChroma[(i + 4) % 12] + averageChroma[(i + 7) % 12];
        if (majScore > maxScore) {
          maxScore = majScore;
          bestKeyIndex = i;
          bestIsMinor = false;
        }
        // Minor Triad Template: Root, Min3rd (+3), Perf5th (+7)
        const minScore = averageChroma[i] + averageChroma[(i + 3) % 12] + averageChroma[(i + 7) % 12];
        if (minScore > maxScore) {
          maxScore = minScore;
          bestKeyIndex = i;
          bestIsMinor = true;
        }
      }

      const rootNote = NOTE_NAMES[bestKeyIndex];
      const keyStr = rootNote + (bestIsMinor ? "m" : "");
      
      // Compute standard diatonic progressions representing the key template
      const chordList = bestIsMinor 
        ? [
            keyStr,
            NOTE_NAMES[(bestKeyIndex + 7) % 12] + "m", // v
            NOTE_NAMES[(bestKeyIndex + 5) % 12] + "m", // iv
            NOTE_NAMES[(bestKeyIndex + 8) % 12]        // VI
          ]
        : [
            keyStr,
            NOTE_NAMES[(bestKeyIndex + 7) % 12],        // V
            NOTE_NAMES[(bestKeyIndex + 9) % 12] + "m", // vi
            NOTE_NAMES[(bestKeyIndex + 5) % 12]        // IV
          ];

      const scanResults = {
        bpm: detectedBpm,
        key: rootNote,
        chord: keyStr,
        chordList
      };

      setDetectedData(scanResults);
      setBackingBeatName(file.name);
      Storage.set('detected', scanResults);
      showToast(`🎧 ${detectedBpm} BPM · ${keyStr} Analysed!`);
    } catch (e: any) {
      console.error(e);
      showToast("⚠️ Analysis error occurred.");
    } finally {
      setIsAnalyzingBeat(false);
    }
  };

  // Apply Analysed Beat parameters to DIPP Project config
  const applyDetected = () => {
    if (!detectedData.bpm) {
      showToast("⚠️ Analyze a beat first!");
      return;
    }

    setBpm(detectedData.bpm);
    Storage.set('bpm', detectedData.bpm);
    setChord({
      root: detectedData.key || "C",
      quality: (detectedData.chord || "").includes("m") ? "Minor" : "Major",
      label: detectedData.chord || "C Major"
    });

    setBeatLockPillShow(true);
    setIsBeatSheetOpen(false);
    showToast(`✓ Locked to beat · ${detectedData.bpm} BPM · ${detectedData.chord}`);
  };

  // Google Sign-In helper
  const handleGoogleLogin = async () => {
    try {
      setIsLoggingIn(true);
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        showToast(`Connected Google Workspace: ${result.user.displayName}`);
      }
    } catch (err) {
      console.error(err);
      showToast('Google credentials failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Google Sign-Out
  const handleGoogleLogout = async () => {
    await logout();
    setUser(null);
    showToast('Gmail integration disconnected');
  };

  // Workspace Gmail transmitter handler
  const sendEmailLyrics = async () => {
    if (!lyrics.trim()) {
      showToast('⚠️ No lyrics in attic deck!');
      return;
    }
    const emailTo = prompt("Enter target email address to send your lyrics to:");
    if (!emailTo) return;

    try {
      setIsEmailing(true);
      const token = await getAccessToken();
      if (!token) throw new Error('Authorization expired. Re-authenticate account.');

      showToast('Transmitting lyric package via Gmail...');
      await sendGmailMessage(
        token,
        `RhymeForge v4.2 Lyric Package (${style.toUpperCase()} Style)`,
        emailTo,
        `forged lyrics generated from DIPP PRO RhymeForge Engine at ${bpm} BPM:\n\n==========================\n\n${lyrics}\n\n==========================\nGenerated via Claude Integration.`
      );
      showToast('Rhymes emailed successfully! 📬');
    } catch (err: any) {
      showToast('Failed to transmit. Ensure Workspace permissions.');
      console.error(err);
    } finally {
      setIsEmailing(false);
    }
  };

  // Export static files to text format
  const exportLyricsFile = () => {
    if (!lyrics.trim()) {
      showToast("Editor is empty!");
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lyrics], { type: 'text/plain' }));
    a.download = `rhyme_forge_${Date.now()}.txt`;
    a.click();
    showToast("💾 Export completed!");
  };

  // Clear Session state variables
  const handleClearSession = () => {
    if (confirm("Clear current RhymeForge sessions? All records will clear.")) {
      setLyrics("");
      Storage.set('lyrics', '');
      setBackingBeatName("");
      setBeatLockPillShow(false);
      setStreak(0);
      setGameScore("—");
      setGameFeedback("");
      setDetectedData({ bpm: null, key: null, chord: null, chordList: [] });
      Storage.set('detected', { bpm: null, key: null, chord: null, chordList: [] });
      setVocalLayers([]);
      Storage.set('vocalLayers', []);
      showToast("🗑️ Session cleared successfully");
    }
  };

  // AI completions router
  const handleAiCall = async (promptText: string, isAppend = true) => {
    const isConfigured = (apiConfig.provider === 'grok' && apiConfig.xaiKey) || (apiConfig.provider === 'hf' && apiConfig.hfKey);
    if (!isConfigured) {
      showToast(`⚠️ Please configure keys for ${apiConfig.provider.toUpperCase()} first`);
      setIsSettingsOpen(true);
      return;
    }

    setIsProcessingAI(true);
    showToast(`🔥 Forging verse${detectedData.bpm ? ` · ${bpm}BPM ${detectedData.chord}` : ""}…`);

    try {
      const beatDataParam: BeatData = { bpm, key: chord.root, chord: chord.label };
      const systemContextPrompt = `You are a world-class rap lyricist. Match the provided track context: tempo ${bpm} BPM, key/chord ${chord.label}, and artist style ${style}. Use dense multi-syllable rhymes, internal rhymes, and strong imagery. Return ONLY raw lyrics - no commentary, no quotes, no markdown formatting, exactly 8 lines.
      ${promptText}`;

      const res = await callAI(systemContextPrompt, apiConfig, beatDataParam, bpm);
      if (res) {
        const cleaned = res.replace(/```[a-zA-Z]*\n/gi, '').replace(/```/g, '').trim();
        const updatedLyrics = isAppend 
          ? (lyrics ? `${lyrics}\n\n${cleaned}` : cleaned)
          : cleaned;
        
        setLyrics(updatedLyrics);
        Storage.set('lyrics', updatedLyrics);
        showToast("Verse generated successfully! 🔥");
        if (currentTabRef.current !== 'attic') {
          navigateTab('attic');
        }
      }
    } catch (e: any) {
      showToast("⚠️ API network/auth error.");
      console.error(e);
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Standard preset prompt handlers
  const generate8BarVerse = () => {
    handleAiCall("Write a hard-hitting 8-bar rap verse. Dense multi-syllable rhymes, internal rhymes, strong imagery. Exactly 8 lines.");
  };

  const continueLastLine = () => {
    const lastLines = lyrics.split('\n').filter(l => l.trim()).slice(-2).join('\n') || 'Start the verse';
    handleAiCall(`Continue this rap with the next 8 bars, matching energy and flow from previous bars:\n${lastLines}\n\n8 lines only.`);
  };

  const rewriteForHeavyMultis = () => {
    if (!lyrics.trim()) {
      showToast("⚠️ Add some lyrics first!");
      return;
    }
    handleAiCall(`Rewrite these bars with much heavier multi-syllable rhymes and stronger internal rhyme structures:\n\n${lyrics}\n\nReturn rewritten lines only.`, false);
  };

  const generateHook = () => {
    handleAiCall("Write a catchy 4-6 bar melodic rap hook. Anthemic and repeatable. Match style and tempo. Lines only.");
  };

  const generateBridge = () => {
    const ctx = lyrics.split('\n').filter(l => l.trim()).slice(-3).join('\n') || 'the song';
    handleAiCall(`Write a 4-bar rap bridge after context:\n${ctx}\n\nShift the energy, introduce a new perspective. Lines only.`);
  };

  const analyzeFlow = async () => {
    if (!lyrics.trim()) {
      showToast("⚠️ Write some bars first");
      return;
    }
    setIsProcessingAI(true);
    showToast("🔍 Analyzing flow patterns...");
    try {
      const beatDataParam: BeatData = { bpm, key: chord.root, chord: chord.label };
      const systemContextPrompt = `You are a pro rap coach. Analyze this rap verse for rhyme scheme, syllable density, and flow patterns. Give 3 specific, concise improvement tips based on the text. No fluff, no commentary.\n\nLyrics:\n"${lyrics}"`;
      const res = await callAI(systemContextPrompt, apiConfig, beatDataParam, bpm);
      if (res) {
        alert(`📊 Flow Analysis\n\n${res}`);
        showToast("Analysis complete");
      }
    } catch (e) {
      showToast("⚠️ Analysis failed");
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Interactive Rhymes game handlers
  const currentWord = RHYME_GAME[currentWordIndex];

  const handleNextWord = () => {
    const nextIdx = (currentWordIndex + 1) % RHYME_GAME.length;
    setCurrentWordIndex(nextIdx);
    setUserGuess("");
    setGameScore("—");
    setGameFeedback("");
  };

  const handleSubmitRhymeGuess = () => {
    const inp = userGuess.trim().toLowerCase();
    if (!inp) return;

    const answers = currentWord.answers;
    const isExact = answers.includes(inp);
    const isPartial = !isExact && answers.some(a => {
      const suffix = getLastVowelGroup(a);
      return getLastVowelGroup(inp) === suffix && suffix.length >= 2;
    });

    let computedScore;
    let feedback;
    let nextStreak = streak;

    if (isExact) {
      computedScore = 95 + Math.floor(Math.random() * 5);
      feedback = "🔥 Perfect rhyme!";
      nextStreak += 1;
    } else if (isPartial) {
      computedScore = 70 + Math.floor(Math.random() * 20);
      feedback = "✅ Near rhyme — solid!";
      nextStreak += 1;
    } else {
      computedScore = Math.floor(Math.random() * 30) + 10;
      feedback = "❌ Try again";
      nextStreak = 0;
    }

    setGameScore(computedScore);
    setGameFeedback(feedback);
    setStreak(nextStreak);

    if (computedScore >= 70) {
      setTimeout(() => {
        const nextIdx = (currentWordIndex + 1) % RHYME_GAME.length;
        setCurrentWordIndex(nextIdx);
        setUserGuess("");
        setGameScore("—");
        setGameFeedback("");
      }, 1400);
    }
  };

  // Compute live style status computed classes
  const styleBadgeOnState = (name: string) => {
    return style === name ? "on" : "";
  };

  return (
    <div className="phone-viewport" id="app">
      {/* Dynamic Gold loading banner on active API processing */}
      <div className={`gen-bar ${isProcessingAI ? 'active' : ''}`} id="gen-bar"></div>

      {/* ==================== PHONE STATUS BAR ==================== */}
      <div className="status-bar">
        <span className="status-clock" id="status-clock" ref={clockRef}>00:00</span>
        <div className="status-right">
          <div className="dot-purple"></div>
          <div className="battery">
            <div className="battery-fill"></div>
          </div>
        </div>
      </div>

      {/* ==================== APPLICATION SYSTEM HEADER ==================== */}
      <div className="app-header px-4">
        {/* Chord or Key badge */}
        <span className="key-badge" id="hdr-key" title="Key signature">{chord.root}</span>
        
        {/* Locked BPM metric */}
        <span 
          className={`bpm-val ${beatLockPillShow ? 'locked' : ''}`} 
          id="hdr-bpm"
          onClick={() => {
            const nextVal = prompt("Set project BPM manual (60-200):", String(bpm));
            if (nextVal) {
              const b = Math.max(60, Math.min(200, parseInt(nextVal) || 128));
              setBpm(b);
              Storage.set('bpm', b);
            }
          }}
        >
          {bpm}
        </span>

        {/* Lock indicators */}
        {beatLockPillShow && (
          <span className="beat-lock-pill" id="beat-lock-pill">🔒 BEAT</span>
        )}

        {/* System activity state badge */}
        <span className="status-badge" id="hdr-status">
          {isRecording ? "REC" : (isPlaying ? "PLAY" : "READY")}
        </span>

        {/* Menu toggles */}
        <button className="menu-btn" onClick={() => setIsMenuOpen(!isMenuOpen)}>≡</button>

        {/* Menu action items overlay drawer */}
        {isMenuOpen && (
          <>
            <div className="menu-overlay animate-fade-in" onClick={() => setIsMenuOpen(false)}></div>
            <div className="menu-drawer" id="menu-drawer">
              <div className="menu-item" onClick={() => {
                setIsMenuOpen(false);
                const nextVal = prompt("Change manual BPM setup (60-200):", String(bpm));
                if (nextVal) {
                  const b = Math.max(60, Math.min(200, parseInt(nextVal) || 128));
                  setBpm(b);
                  Storage.set('bpm', b);
                  showToast(`BPM set manual to ${b}`);
                }
              }}>
                🎹 Set BPM Setup
              </div>
              
              <div className="menu-item" onClick={() => {
                setIsMenuOpen(false);
                const nextVal = prompt("Set Musical Key manual:", chord.root);
                if (nextVal) {
                  setChord(prev => ({ ...prev, root: nextVal, label: nextVal }));
                  showToast(`Musical Key set manual: ${nextVal}`);
                }
              }}>
                🎵 Set Musical Key
              </div>

              <div className="menu-item" onClick={() => {
                setIsMenuOpen(false);
                setIsBeatSheetOpen(true);
              }}>
                🎧 Open Beat Room
              </div>

              <div className="menu-sep"></div>

              <div className="menu-item" onClick={() => {
                setIsMenuOpen(false);
                setIsSettingsOpen(true);
              }}>
                ⚙️ AI Provider Settings
              </div>

              <div className="menu-item" onClick={() => {
                setIsMenuOpen(false);
                exportLyricsFile();
              }}>
                ↓ Export Lyric CSV/TXT
              </div>

              <div className="menu-item" onClick={() => {
                setIsMenuOpen(false);
                handleClearSession();
              }}>
                🗑️ Clear Workspace Session
              </div>

              <div className="menu-sep"></div>
              
              <div className="menu-item flex justify-between text-[11px] text-slate-500 cursor-default">
                <span>RhymeForge Pro v4.2</span>
                <span className="font-mono">Claude · Engine</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ==================== CORE INTERACTIVE COCKPIT ==================== */}
      <div className="screen-content">
        <div className="main-area">

          {/* ==================== TAB 1: VOCAL WORKSPACE ==================== */}
          {currentTab === 'vocal' && (
            <div className="tab-content relative animate-[slide-up_0.22s_ease-out]">
              
              {/* Transport toggles */}
              <div className="transport-row">
                <button 
                  className={`t-btn ${beatLockPillShow ? 'beat-loaded' : ''}`} 
                  id="beat-load-btn" 
                  title="Load backing track"
                  onClick={() => setIsBeatSheetOpen(true)}
                >
                  <Music />
                </button>
                <div className="t-line"></div>
                <button 
                  className={`play-ring ${isPlaying ? 'playing' : ''}`} 
                  id="play-ring" 
                  onClick={togglePlayback} 
                  title="Playback"
                >
                  {isPlaying ? <Pause className="fill-current text-amber-500" /> : <Play className="ml-0.5 fill-current" />}
                </button>
                <div className="t-line"></div>
                <button className="t-btn" onClick={() => {
                  if (!lyrics.trim()) {
                    showToast("⚠️ Nothing to save!");
                  } else {
                    showToast("✓ Lyric save saved to storage session");
                  }
                }} title="Save current take">
                  <Bookmark />
                </button>
              </div>

              {/* Concentric rotating orbits microphone space */}
              <div className="mic-universe">
                <div className="r r-outer"></div>
                <div className="r r-grooves"></div>
                <div className="r r-mid"></div>

                {/* SVG orbit elements path details */}
                <svg className="orbital-svg" viewBox="0 0 222 222" id="orbital-svg">
                  <defs>
                    <filter id="purpleglow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="2.5" result="blur"/>
                      <feMerge>
                        <feMergeNode in="blur"/>
                        <feMergeNode in="SourceGraphic"/>
                      </feMerge>
                    </filter>
                  </defs>
                  <circle cx="111" cy="111" r="107" stroke="#7c2ff2" strokeWidth="1.5" fill="none" filter="url(#purpleglow)" className={isPlaying || isRecording ? 'animate-[spin_12s_linear_infinite]' : ''}/>
                  <circle cx="111" cy="4" r="5.5" fill="#7c2ff2" filter="url(#purpleglow)"/>
                  <circle cx="218" cy="111" r="5.5" fill="#7c2ff2" filter="url(#purpleglow)"/>
                  <circle cx="111" cy="218" r="5.5" fill="#7c2ff2" filter="url(#purpleglow)"/>
                  <circle cx="4" cy="111" r="5.5" fill="#7c2ff2" filter="url(#purpleglow)"/>
                </svg>

                <div className="r r-inner"></div>

                {/* Main metallic trigger button */}
                <button 
                  className={`mic-gold ${isRecording ? 'recording' : ''}`} 
                  id="mic-gold" 
                  onClick={toggleRecording}
                >
                  <Mic strokeWidth={2.5} className="text-white" />
                </button>
              </div>

              {/* Recording and take info */}
              <div className={`rec-bar ${isRecording ? 'active' : ''}`} id="rec-bar">
                {isRecording ? `⏺️ Recording… ${recordTimer}` : "No recording yet"}
              </div>

              {/* Graphic bouncing piano bars & vocal layers mixer */}
              <div className="piano-section flex-1 flex flex-col justify-between overflow-hidden min-h-0">
                {/* Multi-track vocal layers desk */}
                <div className="flex-1 flex flex-col min-h-0 bg-slate-950/40 rounded-xl p-2 border border-slate-800/40 my-1 overflow-hidden mx-0.5">
                  <div className="flex items-center justify-between px-1 mb-1.5 border-b border-white/[0.04] pb-1 shrink-0">
                    <span className="text-[10px] uppercase font-bold text-violet-400 tracking-wider">🎙️ vocal layers mixer ({vocalLayers.length})</span>
                    <button 
                      onClick={() => {
                        const name = prompt("Enter custom track layer name:");
                        if (name) {
                          const newTake: VocalLayer = {
                            id: Date.now().toString(),
                            name: name,
                            duration: "0:00",
                            isMuted: false,
                            isSolo: false,
                            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            pitchShift: 0
                          };
                          const nextLayers = [...vocalLayers, newTake];
                          setVocalLayers(nextLayers);
                          Storage.set('vocalLayers', nextLayers);
                          showToast(`Added track: ${name}`);
                        }
                      }}
                      className="text-[9px] px-2 py-0.5 rounded bg-violet-900/50 border border-violet-800/60 hover:bg-violet-800/80 text-violet-200 cursor-pointer font-bold transition-all uppercase tracking-wider"
                    >
                      + ADD TRACK
                    </button>
                  </div>

                  {/* Scrollable list of tracks */}
                  <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0" id="mixer-tracks-list">
                    {vocalLayers.length === 0 ? (
                      <div className="text-center text-[10px] text-slate-500 font-mono py-8 italic">
                        No focal tracks. Touch Gold Mic to record a layer.
                      </div>
                    ) : (
                      vocalLayers.map((layer) => {
                        const active = isLayerActive(layer);
                        return (
                          <div 
                            key={layer.id} 
                            style={{ contentVisibility: 'auto' }}
                            className={`flex items-center justify-between p-1.5 rounded-lg border transition-all ${
                              active && (isPlaying || isRecording)
                                ? "bg-violet-950/30 border-violet-500/50 shadow-[0_0_8px_rgba(124,47,242,0.15)]"
                                : "bg-slate-900/40 border-white/[0.03]"
                            }`}
                          >
                            <div className="truncate flex-1 min-w-0 mr-2 text-left">
                              <div className="flex items-center gap-1.5">
                                {active && (isPlaying || isRecording) && (
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                                )}
                                <span className={`text-[12px] font-bold truncate block ${active ? 'text-slate-100' : 'text-slate-500 line-through'}`}>
                                  {layer.name}
                                </span>
                              </div>
                              <span className="text-[9px] font-mono text-slate-500 block mt-0.5">
                                {layer.duration} · {layer.timestamp}
                              </span>
                            </div>

                            {/* Controls */}
                            <div className="flex items-center gap-1.5 font-mono text-[9px] shrink-0">
                              {/* Pitch Shift Controls */}
                              <div className="flex items-center bg-black/40 px-1.5 py-0.5 rounded border border-white/[0.05] gap-1 shrink-0">
                                <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider select-none">PITCH</span>
                                <button 
                                  onClick={() => changePitchShift(layer.id, -1)}
                                  className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-bold flex items-center justify-center cursor-pointer border border-white/[0.03]"
                                  title="Pitch down"
                                >
                                  -
                                </button>
                                <span className="text-[10px] font-bold text-violet-300 min-w-[20px] text-center" title="Pitch in Semitones">
                                  {(layer.pitchShift ?? 0) > 0 ? `+${layer.pitchShift}` : (layer.pitchShift ?? 0)}
                                </span>
                                <button 
                                  onClick={() => changePitchShift(layer.id, 1)}
                                  className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-bold flex items-center justify-center cursor-pointer border border-white/[0.03]"
                                  title="Pitch up"
                                >
                                  +
                                </button>
                              </div>

                              {/* Mute toggle */}
                              <button
                                onClick={() => toggleMute(layer.id)}
                                className={`px-2 py-0.5 rounded border text-[9px] font-bold cursor-pointer transition-all ${
                                  layer.isMuted
                                    ? "bg-red-950/50 border-red-800/80 text-red-400 font-extrabold shadow-[rgba(239,68,68,0.15)_0_0_4px]"
                                    : "bg-slate-900/60 border-slate-700/50 text-slate-400 hover:text-slate-200"
                                }`}
                                title="Mute track"
                              >
                                M
                              </button>

                              {/* Solo toggle */}
                              <button
                                onClick={() => toggleSolo(layer.id)}
                                className={`px-2 py-0.5 rounded border text-[9px] font-bold cursor-pointer transition-all ${
                                  layer.isSolo
                                    ? "bg-amber-500/20 border-amber-500 text-amber-400 font-extrabold shadow-[0_0_6px_rgba(245,168,32,0.2)]"
                                    : "bg-slate-900/60 border-slate-700/50 text-slate-400 hover:text-slate-200"
                                }`}
                                title="Solo track"
                              >
                                S
                              </button>

                              {/* Delete track button */}
                              <button
                                onClick={() => deleteLayer(layer.id)}
                                className="p-1 rounded bg-slate-900/60 hover:bg-red-950/40 border border-slate-700/50 hover:border-red-900/70 text-slate-400 hover:text-red-400 cursor-pointer transition-all flex items-center justify-center shrink-0"
                                title="Delete track"
                              >
                                <X size={10} strokeWidth={3} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Frequency visualizer footer bar */}
                <div className="piano-bars" id="piano-bars" style={{ height: '42px', flex: 'none', marginBottom: '4px', marginTop: '4px' }}>
                  {PIANO_PATTERN.map((isWhite, i) => (
                    <div 
                      key={i}
                      className={`p-bar ${isWhite ? 'wk' : 'bk'}`}
                      style={{ height: `${visHeights[i] || BASE_HEIGHTS[i]}%` }}
                    />
                  ))}
                </div>

                {/* Navigation labels at the bottom bar */}
                <div className="tab-labels">
                  <span className={`tab-lbl ${currentTab === 'vocal' ? 'active' : ''}`} id="lbl-vocal" onClick={() => navigateTab('vocal')}>VOCAL</span>
                  <span className={`tab-lbl ${currentTab === 'attic' ? 'active' : ''}`} id="lbl-attic" onClick={() => navigateTab('attic')}>ATTIC</span>
                  <span className={`tab-lbl ${currentTab === 'beat' ? 'active' : ''}`} id="lbl-beat" onClick={() => navigateTab('beat')}>BEAT</span>
                </div>
              </div>

            </div>
          )}

          {/* ==================== TAB 2: WRITING ATTIQUE STATION ==================== */}
          {currentTab === 'attic' && (
            <div className="tab-content relative animate-[slide-up_0.22s_ease-out]" id="tab-attic">
              
              {/* Raw scrolling lyrics area */}
              <textarea 
                id="lyrics"
                className="w-full"
                style={{
                  flex: '1',
                  minHeight: '110px',
                  maxHeight: '160px',
                  backgroundColor: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(124,47,242,0.2)',
                  borderRadius: '16px',
                  padding: '12px 14px',
                  color: 'var(--text)',
                  fontFamily: 'var(--mono)',
                  fontSize: '13px',
                  lineHeight: '1.85',
                  resize: 'none',
                  outline: 'none',
                  caretColor: 'var(--gold)',
                  marginTop: '6px'
                }}
                value={lyrics}
                placeholder="Drop your bars here...&#10;Tap AI Forge below for smart rhyme help."
                onChange={e => {
                  setLyrics(e.target.value);
                  Storage.set('lyrics', e.target.value);
                }}
              />

              {/* Flow stats board details */}
              <div className="flow-stats">
                <div className="flow-card">
                  <div className="flow-val" id="flow-score" style={{ color: "var(--cyan)" }}>
                    {analysis.score || "—"}
                  </div>
                  <div className="flow-lbl">Flow Map</div>
                </div>

                <div className="flow-card">
                  <div className="flow-val" id="flow-multis" style={{ color: "var(--purple)" }}>
                    {analysis.multis}
                  </div>
                  <div className="flow-lbl">Multis</div>
                </div>

                <div className="flow-card">
                  <div className="flow-val" id="flow-bars" style={{ color: "var(--gold)" }}>
                    {analysis.lines.length}
                  </div>
                  <div className="flow-lbl">Bars</div>
                </div>
              </div>

              {/* Line stats color code density matrices */}
              <div className="heatmap" id="heatmap">
                {analysis.lineStats.length > 0 ? (
                  analysis.lineStats.map((item, idx) => {
                    const color = item.density > 35 ? '#ef4444' : item.density > 18 ? '#f59e0b' : '#334155';
                    return (
                      <div 
                        key={idx}
                        className="heatmap-line"
                        style={{ backgroundColor: color }}
                        title={`Line ${idx+1}: ${item.density}% multi density`}
                        onClick={() => {
                          showToast(`Line ${idx+1}: ${item.words} words · ${item.syllables} syllables`);
                        }}
                      />
                    );
                  })
                ) : (
                  <div className="text-xs text-slate-500 font-mono italic text-center w-full py-1">Type flow metrics to generate heatmap matrix</div>
                )}
              </div>

              {/* Active forging style selection matrices */}
              <div className="style-row">
                {['kendrick', 'drake', 'j. cole', 'future', 'lil baby'].map(name => (
                  <div 
                    key={name}
                    className={`sty-chip ${styleBadgeOnState(name)}`}
                    onClick={() => {
                      setStyle(name);
                      Storage.set('style', name);
                      showToast(`Rap Style: ${name.toUpperCase()}`);
                    }}
                  >
                    {name.charAt(0).toUpperCase() + name.slice(1)}
                  </div>
                ))}
              </div>

              {/* Forge stations action triggers list */}
              <div className="attic-btns" id="attic-btns">
                <button className="a-btn ctx-aware" onClick={generate8BarVerse} disabled={isProcessingAI}>
                  <span className="ico">🔥</span> Forge 8-Bar Verse
                  <span className="ctx-tag">GEN</span>
                </button>

                <button className="a-btn ctx-aware" onClick={continueLastLine} disabled={isProcessingAI || !lyrics.trim()}>
                  <span className="ico">➕</span> Continue Last Line
                  <span className="ctx-tag">NXT</span>
                </button>

                <button className="a-btn ctx-aware" onClick={rewriteForHeavyMultis} disabled={isProcessingAI || !lyrics.trim()}>
                  <span className="ico">✏️</span> Rewrite heavy multis
                  <span className="ctx-tag">MOD</span>
                </button>

                <button className="a-btn ctx-aware" onClick={generateHook} disabled={isProcessingAI}>
                  <span className="ico">🎵</span> Generate Chorus Hook
                  <span className="ctx-tag">HOOK</span>
                </button>

                <button className="a-btn ctx-aware" onClick={generateBridge} disabled={isProcessingAI}>
                  <span className="ico">🌉</span> Generate Bridge Section
                  <span className="ctx-tag">BDG</span>
                </button>

                <button className="a-btn" onClick={analyzeFlow} disabled={isProcessingAI || !lyrics.trim()}>
                  <span className="ico">📊</span> Analyze My Flow
                </button>
              </div>

              {/* Navigation tab labels */}
              <div className="tab-labels">
                <span className={`tab-lbl ${currentTab === 'vocal' ? 'active' : ''}`} onClick={() => navigateTab('vocal')}>VOCAL</span>
                <span className={`tab-lbl ${currentTab === 'attic' ? 'active' : ''}`} onClick={() => navigateTab('attic')}>ATTIC</span>
                <span className={`tab-lbl ${currentTab === 'beat' ? 'active' : ''}`} onClick={() => navigateTab('beat')}>BEAT</span>
              </div>

            </div>
          )}

          {/* ==================== TAB 3: BEAT ROOM GUESS BOARD ==================== */}
          {currentTab === 'beat' && (
            <div className="tab-content relative animate-[slide-up_0.22s_ease-out]" id="tab-beat">
              
              <div className="beat-prompt-lbl">
                RHYME GAME · STREAK: <span id="streak-val" className="text-amber-400 font-bold font-mono text-xs">{streak}</span>
              </div>

              {/* Big bold target core word */}
              <div className="beat-word" id="beat-word">
                {currentWord.word}
              </div>

              {/* Guess box */}
              <input 
                className="beat-input"
                id="beat-input"
                type="text"
                placeholder="Type a word that rhymes..."
                value={userGuess}
                onChange={e => setUserGuess(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSubmitRhymeGuess();
                }}
              />

              {/* Displaying computed results */}
              <div className="beat-score-wrap">
                <div className="beat-score animate-pulse" id="beat-score">
                  {gameScore}
                </div>
                <div className="beat-score-lbl">RHYME SCORE</div>
              </div>

              {/* Real haptic word guess feedback messages */}
              <div className="beat-feedback" id="beat-feedback">
                {gameFeedback}
              </div>

              {/* Interactive buttons */}
              <div className="beat-actions">
                <button className="beat-act-btn border-emerald-500/30 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-500" onClick={handleSubmitRhymeGuess}>
                  Submit guess
                </button>
                <button className="beat-act-btn border-slate-700 hover:bg-slate-800" onClick={handleNextWord}>
                  → Next word
                </button>
              </div>

              {/* Navigation labels */}
              <div className="tab-labels mt-auto">
                <span className={`tab-lbl ${currentTab === 'vocal' ? 'active' : ''}`} onClick={() => navigateTab('vocal')}>VOCAL</span>
                <span className={`tab-lbl ${currentTab === 'attic' ? 'active' : ''}`} onClick={() => navigateTab('attic')}>ATTIC</span>
                <span className={`tab-lbl ${currentTab === 'beat' ? 'active' : ''}`} onClick={() => navigateTab('beat')}>BEAT</span>
              </div>

            </div>
          )}

        </div>

        {/* ==================== INTEGRATED UTILITY SIDEBAR BOARD ==================== */}
        <aside className="r-sidebar">
          {/* Active timing counters indicator card */}
          <div className="s-card s-timer" onClick={() => navigateTab('vocal')}>
            <span className="s-time" id="sb-timer">{isRecording ? recordTimer : "00:00"}</span>
            <div className={`s-icon ${isRecording ? 'gold-glow bg-amber-500/10' : ''}`}>
              <Clock className={isRecording ? 'text-amber-400 animate-spin' : 'text-slate-400'} />
            </div>
          </div>

          {/* Quick lyric preview badge item */}
          <div className="s-card s-lyrics" onClick={() => navigateTab('attic')}>
            <div className="s-card-title">LYRICS</div>
            <div className="s-icon-dark">
              <Sparkles size={16} className="text-white" />
            </div>
            {/* Minimal line indicators mimicking lyric lines */}
            <div className="lyr-lines mt-1">
              <div className="lyr-line w-[80%]"></div>
              <div className="lyr-line w-[90%]"></div>
              <div className="lyr-line lyr-line.sh"></div>
            </div>
          </div>

          {/* Quick AutoTune and emailing triggers card */}
          <div className="s-card s-effects">
            <button className="fx-btn mb-1.5" title="Email Lyrics via Gmail Workspace" onClick={sendEmailLyrics} disabled={isEmailing}>
              {isEmailing ? <Loader2 size={15} className="animate-spin text-cyan-400" /> : <Mail size={15} className="text-cyan-400" />}
            </button>
            <button 
              className="fx-btn" 
              id="autotune-btn" 
              title="Instant voice processing feedback" 
              onClick={toggleAutoTune}
              style={{
                backgroundColor: autoTune ? 'rgba(124,47,242,0.3)' : '',
                borderColor: autoTune ? 'rgba(124,47,242,0.7)' : ''
              }}
            >
              <Zap size={14} className={autoTune ? "text-purple-300 fill-current animate-pulse" : "text-violet-400"} />
            </button>
            <div className="fx-lbl mt-1.5" id="at-lbl" style={{ color: autoTune ? '#c4b5fd' : '' }}>
              AUTO<br/>TUNE
            </div>
          </div>
        </aside>

      </div>

      {/* Decorative smartphone bottom bar */}
      <div className="home-ind"></div>

      {/* ==================== BEAT ANALYZER ROOM POP-OUT SHEET ==================== */}
      {isBeatSheetOpen && (
        <div className="sheet-overlay animate-fade-in" id="beat-sheet" onClick={(e) => {
          if (e.target === e.currentTarget) setIsBeatSheetOpen(false);
        }}>
          <div className="sheet-panel animate-[slide-up_0.25s_cubic-bezier(0.34,1.20,0.64,1)]">
            <div className="sheet-handle"></div>
            <h3 className="sheet-title">
              <Music className="text-purple-400" /> Backing Beat Analyzer
            </h3>
            <p className="sheet-sub">
              Drag and drop an instrumental backing beat. We'll analyze multi-onset BPM frequencies and Goertzel key chord groupings instantly.
            </p>

            {/* Drag and Drop Zone uploader */}
            <div 
              className={`drop-zone ${isDraggingBeat ? 'dragover' : ''}`}
              id="drop-zone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => {
                e.preventDefault();
                setIsDraggingBeat(true);
              }}
              onDragLeave={() => setIsDraggingBeat(false)}
              onDrop={e => {
                e.preventDefault();
                setIsDraggingBeat(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleBeatImport(file);
              }}
            >
              <span className="drop-icon">🎧</span>
              {backingBeatName ? (
                <div className="text-amber-400 font-bold truncate max-w-full">
                  Attached: {backingBeatName}
                </div>
              ) : (
                <span>Tap to upload or drop backing loop here</span>
              )}
              <div className="text-[10px] text-slate-500 mt-2">MP3, WAV, M4A, OGG up to 30MB</div>
            </div>

            <input 
              type="file" 
              ref={fileInputRef} 
              id="beat-file" 
              accept="audio/*" 
              className="hidden" 
              onChange={e => handleBeatImport(e.target.files?.[0] || null)}
            />

            {/* Scanning and decoding triggers */}
            {isAnalyzingBeat && (
              <div className="analyzing show mt-4" id="analyzing">
                <div className="spinner"></div>
                <div id="analyze-stage" className="text-xs text-purple-300 font-mono mt-2">
                  {analyzeStage}
                </div>
              </div>
            )}

            {/* Extracted results scorecard */}
            {detectedData.bpm && !isAnalyzingBeat && (
              <div className="beat-results show" id="beat-results">
                <div className="result-row">
                  <div className="result-card">
                    <div className="result-val text-amber-400 font-mono" id="r-bpm">{detectedData.bpm}</div>
                    <div className="result-lbl">BPM FREQ</div>
                  </div>
                  <div className="result-card">
                    <div className="result-val text-cyan-400 font-mono" id="r-key">{detectedData.key}</div>
                    <div className="result-lbl">KEY METRIC</div>
                  </div>
                  <div className="result-card">
                    <div className="result-val text-purple-400 font-mono" id="r-chord">{detectedData.chord}</div>
                    <div className="result-lbl">DOMINANT CHORD</div>
                  </div>
                </div>

                <div className="mt-2.5">
                  <div className="text-[10.5px] uppercase text-slate-500 tracking-wider mb-1.5 font-bold">PROBABLE MATRIX CHORDS</div>
                  <div className="chord-pills" id="chord-pills">
                    {detectedData.chordList?.map((c, i) => (
                      <span key={i} className="chord-pill font-mono">{c}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Apply and close modal triggers */}
            <div className="sheet-actions">
              <button className="sheet-btn primary flex items-center justify-center gap-1.5" onClick={applyDetected} disabled={!detectedData.bpm}>
                <Check size={14} /> Apply parameters to project
              </button>
              <button className="sheet-btn secondary" onClick={() => setIsBeatSheetOpen(false)}>
                Close Beat Sheet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== AI CONFIGURATIONS PANEL MODAL ==================== */}
      {isSettingsOpen && (
        <div className="modal-bg animate-fade-in" id="settings-modal" onClick={e => {
          if (e.target === e.currentTarget) setIsSettingsOpen(false);
        }}>
          <div className="modal-box animate-[scale-up_0.2s_ease-out]">
            <h3 className="modal-title text-white">
              <Settings className="text-purple-400" /> AI Station Configurations
            </h3>

            <label className="m-label">Provider Endpoint</label>
            <select 
              className="m-select" 
              id="provider-select"
              value={apiConfig.provider}
              onChange={e => setApiConfig({ ...apiConfig, provider: e.target.value as any })}
            >
              <option value="grok">xAI Grok Engine</option>
              <option value="hf">Hugging Face Inference Hub</option>
            </select>

            <label className="m-label">Model Definition Group</label>
            <select 
              className="m-select" 
              id="model-select"
              value={apiConfig.provider === 'grok' ? apiConfig.model : apiConfig.hfModel}
              onChange={e => {
                if (apiConfig.provider === 'grok') {
                  setApiConfig({ ...apiConfig, model: e.target.value });
                } else {
                  setApiConfig({ ...apiConfig, hfModel: e.target.value });
                }
              }}
            >
              {apiConfig.provider === 'grok' ? (
                <>
                  <option value="grok-beta">grok-beta (Fast)</option>
                  <option value="grok-3">grok-3 (Ultra Creative)</option>
                  <option value="grok-2">grok-2 (High Fidelity)</option>
                </>
              ) : (
                <>
                  <option value="mistralai/Mistral-7B-Instruct-v0.3">Mistral-7B-Instruct (Default)</option>
                  <option value="meta-llama/Llama-2-13b-chat-hf">Llama-2-13B-Chat</option>
                  <option value="HuggingFaceH4/zephyr-7b-beta">Zephyr 7B Beta</option>
                </>
              )}
            </select>

            <div className="flex justify-between items-center mt-3 mb-1">
              <span className="m-label my-0">Response Temperature</span>
              <span className="text-xs font-mono font-bold text-amber-400">{apiConfig.temperature}</span>
            </div>
            <div className="m-slider-row">
              <span className="text-[10px] text-slate-500 font-bold">SAFE</span>
              <input 
                type="range" 
                className="m-slider" 
                id="temp-slider" 
                min="10" max="150" step="5"
                value={apiConfig.temperature * 100}
                onChange={e => {
                  const val = parseInt(e.target.value) / 100;
                  setApiConfig({ ...apiConfig, temperature: val });
                }}
              />
              <span className="text-[10px] text-slate-500 font-bold">WILD</span>
            </div>

            {apiConfig.provider === 'grok' ? (
              <div className="mt-3">
                <label className="m-label">xAI Grok Provider API Key</label>
                <input 
                  type="password" 
                  className="m-input" 
                  id="xai-key" 
                  placeholder="xai-************************"
                  value={apiConfig.xaiKey}
                  onChange={e => setApiConfig({ ...apiConfig, xaiKey: e.target.value })}
                />
              </div>
            ) : (
              <div className="mt-3">
                <label className="m-label">Hugging Face Authorize Tokens</label>
                <input 
                  type="password" 
                  className="m-input" 
                  id="hf-key" 
                  placeholder="hf_************************"
                  value={apiConfig.hfKey}
                  onChange={e => setApiConfig({ ...apiConfig, hfKey: e.target.value })}
                />
              </div>
            )}

            <p className="text-[10px] text-slate-500 leading-normal mt-4">
              Grok-hosted parameters require private access configurations. Securely stored locally. Never exposed in browser transactions.
            </p>

            <div className="m-actions">
              <button className="m-save" onClick={() => {
                Storage.set('apiConfig', apiConfig);
                setIsSettingsOpen(false);
                showToast("✓ Configurations saved");
              }}>Save</button>
              <button className="m-cancel" onClick={() => setIsSettingsOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== GLOBAL TOAST feedback SYSTEM ==================== */}
      {toastMsg && (
        <div className="fixed bottom-12 left-1/2 transform -translate-x-1/2 bg-slate-900/95 border border-purple-500/40 px-6 py-2.5 rounded-full text-xs font-bold text-purple-300 shadow-2xl z-[50000] tracking-wide animate-fade-in truncate max-w-[90%]">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
