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
