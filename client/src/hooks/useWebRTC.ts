import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export function useWebRTC(socket: Socket | null, roomId: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  // Clean up on unmount
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach(track => track.stop());
      peersRef.current.forEach(peer => peer.close());
      peersRef.current.clear();
    };
  }, [localStream]);

  useEffect(() => {
    if (!socket) return;

    // When someone starts sharing, they are the broadcaster.
    // The existing users in the room will create a PeerConnection and send an offer.
    socket.on('user_started_screen_share', async (senderId: string) => {
      const peer = createPeerConnection(senderId);
      
      // Offer to receive video/audio
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addTransceiver('audio', { direction: 'recvonly' });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socket.emit('webrtc_offer', { targetId: senderId, offer });
    });

    socket.on('user_stopped_screen_share', (senderId: string) => {
      const peer = peersRef.current.get(senderId);
      if (peer) {
        peer.close();
        peersRef.current.delete(senderId);
      }
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.delete(senderId);
        return next;
      });
    });

    socket.on('webrtc_offer', async ({ senderId, offer }) => {
      const peer = createPeerConnection(senderId);
      
      // Add local stream tracks to this peer (since we are the broadcaster answering)
      if (localStream) {
        localStream.getTracks().forEach(track => {
          peer.addTrack(track, localStream);
        });
      }

      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit('webrtc_answer', { targetId: senderId, answer });
    });

    socket.on('webrtc_answer', async ({ senderId, answer }) => {
      const peer = peersRef.current.get(senderId);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('webrtc_ice_candidate', async ({ senderId, candidate }) => {
      const peer = peersRef.current.get(senderId);
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    return () => {
      socket.off('user_started_screen_share');
      socket.off('user_stopped_screen_share');
      socket.off('webrtc_offer');
      socket.off('webrtc_answer');
      socket.off('webrtc_ice_candidate');
    };
  }, [socket, localStream]);

  const createPeerConnection = (targetId: string) => {
    const peer = new RTCPeerConnection(ICE_SERVERS);

    peer.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_ice_candidate', { targetId, candidate: event.candidate });
      }
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(targetId, stream);
          return next;
        });
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        peer.close();
        peersRef.current.delete(targetId);
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(targetId);
          return next;
        });
      }
    };

    peersRef.current.set(targetId, peer);
    return peer;
  };

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      setLocalStream(stream);
      setIsSharingScreen(true);
      
      // Stop sharing when the browser UI "Stop sharing" is clicked
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      if (socket) {
        socket.emit('start_screen_share', { roomId });
      }
    } catch (error) {
      console.error('Error sharing screen:', error);
    }
  };

  const stopScreenShare = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setIsSharingScreen(false);

    if (socket) {
      socket.emit('stop_screen_share', { roomId });
    }

    // Close all peers since we stopped broadcasting
    peersRef.current.forEach(peer => peer.close());
    peersRef.current.clear();
  };

  return {
    localStream,
    remoteStreams,
    isSharingScreen,
    startScreenShare,
    stopScreenShare
  };
}
