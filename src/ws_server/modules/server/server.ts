import WebSocket, { WebSocketServer } from 'ws';
import { SETTINGS } from '../../settings.js';
import { IncomeMessage, SendToClient } from '../../types/index.js';
import { auth } from '../auth/index.js';
import { serialize } from '../../utils/index.js';
import { logger } from '../index.js';
import { createReducer } from '../reducer/root.js';

type Connection = WebSocket & {
  isAlive?: boolean;
  userId?: number;
};

const userConnections = new Map<number, Set<Connection>>();

export const wsServer = new WebSocketServer({ port: SETTINGS.PORT });

const sendToCLient: SendToClient = (message, privacy) => {
  const clients = privacy
    ? privacy.flatMap((userId) => [...(userConnections.get(userId) ?? [])])
    : [...wsServer.clients];

  clients.forEach((client) => client.send(serialize(message)));
};

const reducer = createReducer(sendToCLient);

wsServer.on('connection', (socket) => {
  const connection = socket as Connection;
  connection.isAlive = true;

  connection.on('pong', () => {
    connection.isAlive = true;
  });

  connection.on('error', console.error);

  connection.on('close', () => {
    if (connection.userId !== undefined) {
      const userConnectionSet = userConnections.get(connection.userId);
      userConnectionSet?.delete(connection);
    }
  });

  connection.on('message', (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());

      const parsedMessage = {
        type: message.type,
        data: JSON.parse(message.data),
      } as IncomeMessage;

      if (parsedMessage.type === 'reg') {
        const userId = (() => {
          try {
            console.log('DATA: ', parsedMessage.data);

            return auth(parsedMessage.data);
          } catch (error) {
            connection.send(
              serialize({
                type: 'reg',
                data: {
                  error: true,
                  errorText: error instanceof Error ? error.message : 'An error has occurred',
                  index: 0,
                  name: parsedMessage.data.name,
                },
              }),
            );

            throw error;
          }
        })();

        const userConnectionSet = userConnections.get(userId) ?? new Set();
        userConnectionSet.add(connection);
        userConnections.set(userId, userConnectionSet);

        connection.userId = userId;

        connection.send(
          serialize({
            type: 'reg',
            data: {
              error: false,
              errorText: '',
              index: userId,
              name: parsedMessage.data.name,
            },
          }),
        );
      } else if (connection.userId) {
        reducer([
          {
            ...parsedMessage,
            id: connection.userId,
          },
        ]);
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error:  ', error.message);
      }
    }
  });
});

const interval = setInterval(() => {
  wsServer.clients.forEach((socket) => {
    const connection = socket as Connection;

    if (connection.isAlive === false) {
      //TODO! IMPLEMENT CODE HERE

      if (connection.userId !== undefined) {
        const userConnectionSet = userConnections.get(connection.userId);
        userConnectionSet?.delete(connection);
      }

      return connection.terminate();
    }

    connection.isAlive = false;
    connection.ping();
  });
}, SETTINGS.TIMEOUT);

wsServer.on('close', () => {
  clearInterval(interval);
});
