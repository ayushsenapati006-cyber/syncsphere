import { useState, useEffect, useRef } from 'react';

export function useActiveSpeaker(stream: MediaStream | null) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setIsSpeaking(false);
      return;
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    
    let source: MediaStreamAudioSourceNode;
    try {
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch (e) {
      return;
    }

    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationFrame: number;
    let speakingTimeout: ReturnType<typeof setTimeout>;

    const checkLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((acc, val) => acc + val, 0);
      const average = sum / dataArray.length;

      if (average > 15) {
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true;
          setIsSpeaking(true);
        }
        clearTimeout(speakingTimeout);
        speakingTimeout = setTimeout(() => {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
        }, 1500);
      }

      animationFrame = requestAnimationFrame(checkLevel);
    };

    checkLevel();

    return () => {
      cancelAnimationFrame(animationFrame);
      clearTimeout(speakingTimeout);
      try {
        source.disconnect();
      } catch (e) {}
      audioContext.close();
    };
  }, [stream]);

  return isSpeaking;
}
