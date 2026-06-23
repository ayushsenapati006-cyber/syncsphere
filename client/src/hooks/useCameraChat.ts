import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export function useCameraChat(socket: Socket | null, roomId: string) {
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isCameraActive, setIsCameraActive] = useState(false);
  
  const cameraPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  // Clean up on unmount
  useEffect(() => {
    return () => {
      localVideoStream?.getTracks().forEach(track => track.stop());
      cameraPeersRef.current.forEach(peer => peer.close());
      cameraPeersRef.current.clear();
    };
  }, [localVideoStream]);

  useEffect(() => {
    if (!socket) return;

    socket.on('user_joined_camera', async (senderId: string) => {
      const peer = createCameraPeer(senderId);
      
      if (localVideoStream) {
        localVideoStream.getTracks().forEach(track => {
          peer.addTrack(track, localVideoStream);
        });
      } else {
        peer.addTransceiver('video', { direction: 'recvonly' });
      }

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socket.emit('camera_webrtc_offer', { targetId: senderId, offer });
    });

    socket.on('user_left_camera', (senderId: string) => {
      const peer = cameraPeersRef.current.get(senderId);
      if (peer) {
        peer.close();
        cameraPeersRef.current.delete(senderId);
      }
      setRemoteVideoStreams(prev => {
        const next = new Map(prev);
        next.delete(senderId);
        return next;
      });
    });

    socket.on('camera_webrtc_offer', async ({ senderId, offer }) => {
      const peer = createCameraPeer(senderId);
      
      if (localVideoStream) {
        localVideoStream.getTracks().forEach(track => {
          peer.addTrack(track, localVideoStream);
        });
      }

      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit('camera_webrtc_answer', { targetId: senderId, answer });
    });

    socket.on('camera_webrtc_answer', async ({ senderId, answer }) => {
      const peer = cameraPeersRef.current.get(senderId);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('camera_webrtc_ice_candidate', async ({ senderId, candidate }) => {
      const peer = cameraPeersRef.current.get(senderId);
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    return () => {
      socket.off('user_joined_camera');
      socket.off('user_left_camera');
      socket.off('camera_webrtc_offer');
      socket.off('camera_webrtc_answer');
      socket.off('camera_webrtc_ice_candidate');
    };
  }, [socket, localVideoStream]);

  const createCameraPeer = (targetId: string) => {
    const peer = new RTCPeerConnection(ICE_SERVERS);

    peer.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('camera_webrtc_ice_candidate', { targetId, candidate: event.candidate });
      }
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        setRemoteVideoStreams(prev => {
          const next = new Map(prev);
          next.set(targetId, stream);
          return next;
        });
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        peer.close();
        cameraPeersRef.current.delete(targetId);
        setRemoteVideoStreams(prev => {
          const next = new Map(prev);
          next.delete(targetId);
          return next;
        });
      }
    };

    cameraPeersRef.current.set(targetId, peer);
    return peer;
  };

  const joinCameraChat = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });

      setLocalVideoStream(stream);
      setIsCameraActive(true);
      
      stream.getVideoTracks()[0].onended = () => {
        leaveCameraChat();
      };

      if (socket) {
        socket.emit('user_joined_camera', { roomId });
      }
    } catch (error) {
      console.error('Error joining camera chat:', error);
      alert('Could not access camera. Please check permissions.');
    }
  };

  const leaveCameraChat = () => {
    if (localVideoStream) {
      localVideoStream.getTracks().forEach(track => track.stop());
      setLocalVideoStream(null);
    }
    setIsCameraActive(false);

    if (socket) {
      socket.emit('user_left_camera', { roomId });
    }

    cameraPeersRef.current.forEach(peer => peer.close());
    cameraPeersRef.current.clear();
    setRemoteVideoStreams(new Map());
  };

  return {
    localVideoStream,
    remoteVideoStreams,
    isCameraActive,
    joinCameraChat,
    leaveCameraChat
  };
}
