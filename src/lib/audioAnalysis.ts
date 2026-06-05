import { BeatData } from "./types";

export async function analyzeAudioBuffer(buffer: AudioBuffer): Promise<BeatData> {
  const offlineCtx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  
  const renderedBuffer = await offlineCtx.startRendering();
  const data = renderedBuffer.getChannelData(0);
  
  // BPM detection (simple onset detection)
  const peaks: number[] = [];
  const windowSize = Math.floor(buffer.sampleRate * 0.02);
  
  for (let i = windowSize; i < data.length - windowSize; i++) {
    const slice = data.slice(i, i + windowSize);
    let energy = 0;
    for (let j=0; j<slice.length; j++) energy += slice[j] * slice[j];
    
    if (energy > 0.01 && (peaks.length === 0 || i - peaks[peaks.length - 1] > buffer.sampleRate * 0.3)) {
      peaks.push(i);
    }
  }
  
  let detectedBpm = 120;
  if (peaks.length > 2) {
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    detectedBpm = Math.round(60 / (avgInterval / buffer.sampleRate));
    detectedBpm = Math.max(60, Math.min(200, detectedBpm));
  }

  // Key detection (chroma estimation)
  const chroma = new Array(12).fill(0);
  for (let i = 0; i < data.length; i += 1024) {
    const magnitude = Math.abs(data[i]);
    const noteIndex = Math.floor((Math.log2(440) + Math.log2(magnitude + 1)) * 12) % 12;
    if (!isNaN(noteIndex) && noteIndex >= 0 && noteIndex < 12) {
      chroma[noteIndex] += magnitude;
    }
  }
  
  const maxIndex = chroma.indexOf(Math.max(...chroma));
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const detectedKey = notes[maxIndex] || 'C';
  const detectedChord = `${detectedKey}maj`;

  return { bpm: detectedBpm, key: detectedKey, chord: detectedChord };
}

export function detectBPMFromAnalyser(analyserNode: AnalyserNode, energyHistory: number[]): number | null {
  const bufferLength = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyserNode.getByteFrequencyData(dataArray);

  // Calculate energy (focus on low-mids for beat detection)
  let energy = 0;
  for (let i = 0; i < bufferLength; i++) {
    energy += dataArray[i];
  }
  energy /= bufferLength;

  energyHistory.push(energy);
  if (energyHistory.length > 30) energyHistory.shift(); // Keep last ~12 seconds
  if (energyHistory.length < 10) return null;

  // Detect onsets (sudden energy increases)
  const onsets: number[] = [];
  for (let i = 1; i < energyHistory.length; i++) {
    const prev = energyHistory[i - 1];
    const curr = energyHistory[i];
    if (curr > prev * 1.3 && curr > 30) { // Significant increase
      onsets.push(i);
    }
  }
  if (onsets.length < 4) return null;

  // Calculate average interval between onsets
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    intervals.push(onsets[i] - onsets[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  let estimatedBPM = Math.round(60 / (avgInterval * 0.4)); // 0.4s per interval step

  // Clamp to reasonable range
  estimatedBPM = Math.max(60, Math.min(200, estimatedBPM));
  return estimatedBPM;
}

export function detectChordFromAnalyser(analyserNode: AnalyserNode): string | null {
  const bufferLength = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyserNode.getByteFrequencyData(dataArray);

  const chroma = new Array(12).fill(0);
  const nyquist = analyserNode.context.sampleRate / 2;

  for (let i = 0; i < bufferLength; i++) {
    const freq = (i / bufferLength) * nyquist;
    if (freq < 50 || freq > 2000) continue;
    const semitone = Math.round(12 * Math.log2(freq / 440) + 69) % 12;
    if (semitone >= 0 && semitone < 12) {
      chroma[semitone] += dataArray[i];
    }
  }

  let maxE = 0;
  let root = 0;
  for (let i = 0; i < 12; i++) {
    if (chroma[i] > maxE) {
      maxE = chroma[i];
      root = i;
    }
  }
  if (maxE < 8) return null;

  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rootNote = notes[root];
  const third = (root + 4) % 12;
  const minorThird = (root + 3) % 12;
  const isMinor = chroma[minorThird] > chroma[third] * 0.65;
  let quality = isMinor ? 'Minor' : 'Major';

  const seventh = (root + 10) % 12;
  if (chroma[seventh] > maxE * 0.35) quality += ' 7';

  return `${rootNote} ${quality}`;
}
