import { io, Socket } from 'socket.io-client';
import { SERVER_URL } from './config';

export const socket: Socket = io(SERVER_URL, {
  transports: ['websocket'],
  forceNew: true,
  withCredentials: false,
});
