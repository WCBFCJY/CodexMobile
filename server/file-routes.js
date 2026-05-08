import { sendJson } from './http-utils.js';
import { searchProjectFiles as defaultSearchProjectFiles } from './file-search.js';
import { saveUpload as defaultSaveUpload } from './upload-service.js';

export function createFileRouteHandler({
  getProject,
  searchProjectFiles = defaultSearchProjectFiles,
  staticService,
  saveUpload = defaultSaveUpload,
  uploadRoot,
  maxUploadBytes,
  remoteAddress = () => ''
}) {
  if (!getProject || !staticService) {
    throw new Error('createFileRouteHandler requires getProject and staticService');
  }

  return async function handleFileApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/api/local-image') {
      await staticService.sendLocalImage(req, res, url);
      return true;
    }

    if (method === 'GET' && pathname === '/api/files/search') {
      const project = getProject(url.searchParams.get('projectId') || '');
      if (!project) {
        sendJson(res, 404, { error: 'Project not found' });
        return true;
      }
      try {
        const files = await searchProjectFiles(project, url.searchParams.get('q') || '');
        sendJson(res, 200, { files });
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Failed to search files' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/uploads') {
      const upload = await saveUpload(req, { uploadRoot, maxUploadBytes });
      console.log(`[upload] saved name=${upload.name} size=${upload.size} kind=${upload.kind} remote=${remoteAddress(req)}`);
      sendJson(res, 200, { upload });
      return true;
    }

    return false;
  };
}
