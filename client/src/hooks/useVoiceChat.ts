import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export function useVoiceChat(socket: Socket | null, roomId: string) {
  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const [remoteAudioStreams, setRemoteAudioStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  
  const voicePeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  // Clean up on unmount
  useEffect(() => {
    return () => {
      localAudioStream?.getTracks().forEach(track => track.stop());
      voicePeersRef.current.forEach(peer => peer.close());
      voicePeersRef.current.clear();
    };
  }, [localAudioStream]);

  useEffect(() => {
    if (!socket) return;

    // Existing users will receive this when a new user joins voice chat.
    // They will initiate the peer connection by sending an offer.
    socket.on('user_joined_voice', async (senderId: string) => {
      const peer = createVoicePeer(senderId);
      
      if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => {
          peer.addTrack(track, localAudioStream);
        });
      } else {
        // Even if we aren't sending audio, we want to receive audio
        peer.addTransceiver('audio', { direction: 'recvonly' });
      }

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socket.emit('voice_webrtc_offer', { targetId: senderId, offer });
    });

    socket.on('user_left_voice', (senderId: string) => {
      const peer = voicePeersRef.current.get(senderId);
      if (peer) {
        peer.close();
        voicePeersRef.current.delete(senderId);
      }
      setRemoteAudioStreams(prev => {
        const next = new Map(prev);
        next.delete(senderId);
        return next;
      });
    });

    socket.on('voice_webrtc_offer', async ({ senderId, offer }) => {
      const peer = createVoicePeer(senderId);
      
      if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => {
          peer.addTrack(track, localAudioStream);
        });
      }

      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit('voice_webrtc_answer', { targetId: senderId, answer });
    });

    socket.on('voice_webrtc_answer', async ({ senderId, answer }) => {
      const peer = voicePeersRef.current.get(senderId);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('voice_webrtc_ice_candidate', async ({ senderId, candidate }) => {
      const peer = voicePeersRef.current.get(senderId);
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    return () => {
      socket.off('user_joined_voice');
      socket.off('user_left_voice');
      socket.off('voice_webrtc_offer');
      socket.off('voice_webrtc_answer');
      socket.off('voice_webrtc_ice_candidate');
    };
  }, [socket, localAudioStream]);

  const createVoicePeer = (targetId: string) => {
    const peer = new RTCPeerConnection(ICE_SERVERS);

    peer.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('voice_webrtc_ice_candidate', { targetId, candidate: event.candidate });
      }
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        setRemoteAudioStreams(prev => {
          const next = new Map(prev);
          next.set(targetId, stream);
          return next;
        });
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        peer.close();
        voicePeersRef.current.delete(targetId);
        setRemoteAudioStreams(prev => {
          const next = new Map(prev);
          next.delete(targetId);
          return next;
        });
      }
    };

    voicePeersRef.current.set(targetId, peer);
    return peer;
  };

  const joinVoiceChat = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });

      setLocalAudioStream(stream);
      setIsVoiceActive(true);

      if (socket) {
        socket.emit('user_joined_voice', { roomId });
      }
    } catch (error) {
      console.error('Error joining voice chat:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const leaveVoiceChat = () => {
    if (localAudioStream) {
      localAudioStream.getTracks().forEach(track => track.stop());
      setLocalAudioStream(null);
    }
    setIsVoiceActive(false);

    if (socket) {
      socket.emit('user_left_voice', { roomId });
    }

    voicePeersRef.current.forEach(peer => peer.close());
    voicePeersRef.current.clear();
    setRemoteAudioStreams(new Map());
  };

  return {
    localAudioStream,
    remoteAudioStreams,
    isVoiceActive,
    joinVoiceChat,
    leaveVoiceChat
  };
}
