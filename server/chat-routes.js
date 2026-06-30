/**
 * 注册 `/api/chat` 等聊天相关 HTTP 路由工厂。
 *
 * Keywords: chat-routes, http-handler, streaming
 *
 * Exports:
 * - createChatRouteHandler — 返回挂载聊天 API 的处理函数。
 *
 * Inward（本模块依赖/组装的关键符号）: http-utils、注入的 chatService 等。
 *
 * Outward（谁在用/调用场景）: server/index 装配路由。
 *
 * 不负责: ChatService 内部实现。
 */
import { readBody, sendJson } from './http-utils.js';

export function createChatRouteHandler({
  chatService,
  remoteAddress = () => ''
}) {
  if (!chatService) {
    throw new Error('createChatRouteHandler requires chatService');
  }

  return async function handleChatApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;
    const parts = pathname.split('/').filter(Boolean);

    if (!pathname.startsWith('/api/chat/')) {
      return false;
    }

    if (method === 'GET' && pathname === '/api/chat/interactions') {
      sendJson(res, 200, { interactions: [] });
      return true;
    }

    if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'chat' && parts[2] === 'interactions' && parts[4] === 'respond') {
      sendJson(res, 410, { error: 'Interaction approvals are no longer supported.' });
      return true;
    }

    if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'chat' && parts[2] === 'interactions' && parts[4] === 'cancel') {
      sendJson(res, 410, { error: 'Interaction approvals are no longer supported.' });
      return true;
    }

    if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'chat' && parts[2] === 'turns') {
      const turnId = decodeURIComponent(parts[3]);
      sendJson(res, 200, { turn: chatService.getTurn(turnId) });
      return true;
    }

    if (method === 'GET' && pathname === '/api/chat/queue') {
      sendJson(res, 200, chatService.listQueue({
        sessionId: url.searchParams.get('sessionId') || '',
        draftSessionId: url.searchParams.get('draftSessionId') || ''
      }));
      return true;
    }

    if (method === 'DELETE' && pathname === '/api/chat/queue') {
      const body = await readBody(req);
      const draft = chatService.removeQueuedDraft(body);
      sendJson(res, draft ? 200 : 404, { success: Boolean(draft), draft });
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/queue/restore') {
      const body = await readBody(req);
      const draft = chatService.restoreQueuedDraft(body);
      sendJson(res, draft ? 200 : 404, { success: Boolean(draft), draft });
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/queue/steer') {
      sendJson(res, 410, { error: 'Steer is no longer supported.' });
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/send') {
      const body = await readBody(req);
      try {
        const result = await chatService.sendChat(body, { remoteAddress: remoteAddress(req) });
        sendJson(res, 202, result);
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Failed to send chat' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/compact') {
      sendJson(res, 410, { error: 'Manual context compaction is no longer supported.' });
      return true;
    }

    if (method === 'POST' && pathname === '/api/chat/abort') {
      const body = await readBody(req);
      try {
        const aborted = await chatService.abortChat(body, { remoteAddress: remoteAddress(req) });
        sendJson(res, aborted ? 200 : 404, { aborted });
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Failed to abort chat' });
      }
      return true;
    }

    sendJson(res, 404, { error: 'Chat API route not found' });
    return true;
  };
}
