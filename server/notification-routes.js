import { readBody, sendJson } from './http-utils.js';

export function createNotificationRouteHandler({
  pushService,
  remoteAddress = () => ''
}) {
  if (!pushService) {
    throw new Error('createNotificationRouteHandler requires pushService');
  }

  return async function handleNotificationApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/notifications/')) {
      return false;
    }

    if (method === 'GET' && pathname === '/api/notifications/public-key') {
      sendJson(res, 200, await pushService.publicStatus());
      return true;
    }

    if (method === 'POST' && pathname === '/api/notifications/subscribe') {
      try {
        const body = await readBody(req);
        const result = await pushService.subscribe(body.subscription || body);
        await pushService.sendNotification({
          level: 'success',
          title: '完成通知已开启',
          body: 'CodexMobile 后台通知已经接通。',
          tag: 'codexmobile-notifications-enabled'
        });
        sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        const statusCode = error.statusCode || 500;
        console.warn(`[push] subscribe failed remote=${remoteAddress(req)} message=${error.message}`);
        sendJson(res, statusCode, { error: error.message || 'Failed to subscribe push notification' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/notifications/unsubscribe') {
      try {
        const body = await readBody(req);
        const endpoint = body.endpoint || body.subscription?.endpoint;
        sendJson(res, 200, { success: true, ...(await pushService.unsubscribe(endpoint)) });
      } catch (error) {
        const statusCode = error.statusCode || 500;
        sendJson(res, statusCode, { error: error.message || 'Failed to unsubscribe push notification' });
      }
      return true;
    }

    sendJson(res, 404, { error: 'Notification API route not found' });
    return true;
  };
}
