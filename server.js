'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 12 * 1024 * 1024;
const outfits = [
  { name: 'Denim Maxi', description: 'A charcoal ribbed crop tank with a light-wash denim maxi skirt, knee-high black leather boots, a black leather belt, and small gold hoop earrings.' },
  { name: 'Cloud Set', description: 'A soft oat half-zip sweatshirt and matching wide oat sweatpants, finished with chunky white sneakers and small gold hoops.' },
  { name: 'Library Knit', description: 'A cream cable-knit cardigan layered over a white cotton tee, heather-grey pleated wide trousers, and brown penny loafers.' },
  { name: 'Lilac Run', description: 'A coordinated lilac athletic look: zip training jacket over a lilac sports crop top, high-rise lilac leggings, and white running sneakers.' },
  { name: 'Satin Night', description: 'A powder-blue satin pajama shirt and matching satin pajama trousers, with soft ivory fluffy slippers.' },
  { name: 'Night Suit', description: 'An oversized black blazer over an ivory silk camisole, straight black suit trousers, and black pointed heels.' },
  { name: 'Sage Slip', description: 'A sage satin slip midi dress with a fluid drape, silver strappy sandals, and a fine silver chain necklace.' },
  { name: 'Bomber Cargo', description: 'A black leather bomber over a white crop tee, khaki parachute cargo pants, and black platform sneakers.' }
];
const files = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
let catalogCache = null;
let catalogExpiry = 0;

function apiConfig() {
  const base = process.env.MANUS_API_URL;
  const key = process.env.MANUS_API_KEY;
  if (!base || !key) throw new Error('The managed image service is not available in this runtime.');
  return { base: base.replace(/\/+$/, ''), key };
}

async function connectCall(method, body) {
  const { base, key } = apiConfig();
  const response = await fetch(`${base}/images.v1.ImageService/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'connect-protocol-version': '1'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok || payload.error) {
    const detail = payload.error?.message || payload.message || `Image service returned HTTP ${response.status}.`;
    const error = new Error(String(detail).slice(0, 700));
    error.status = response.status || 502;
    throw error;
  }
  return payload;
}

async function listModels() {
  if (catalogCache && Date.now() < catalogExpiry) return catalogCache;
  const data = await connectCall('ListModels', {});
  catalogCache = Array.isArray(data.models) ? data.models : [];
  catalogExpiry = Date.now() + 10 * 60 * 1000;
  return catalogCache;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('The upload is too large. Please use an image under 8 MB.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('The photo request could not be read. Please choose the image again.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function tryOn(req, res) {
  try {
    const input = await readJson(req);
    if (!input || typeof input.image !== 'string' || !['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType)) {
      return send(res, 400, { error: 'Choose a JPEG, PNG or WebP photograph to continue.' });
    }
    if (input.image.length > 11 * 1024 * 1024) {
      return send(res, 413, { error: 'That photo is too large. Please choose an image under 8 MB.' });
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image)) {
      return send(res, 400, { error: 'That photo could not be read. Please choose the image again.' });
    }
    const imageBuffer = Buffer.from(input.image, 'base64');
    if (!imageBuffer.length || imageBuffer.length > 8 * 1024 * 1024 || imageBuffer.toString('base64') !== input.image) {
      return send(res, imageBuffer.length > 8 * 1024 * 1024 ? 413 : 400, { error: imageBuffer.length > 8 * 1024 * 1024 ? 'Please choose a photo under 8 MB.' : 'That photo could not be read. Please choose the image again.' });
    }
    const isPng = imageBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff;
    const isWebp = imageBuffer.toString('ascii', 0, 4) === 'RIFF' && imageBuffer.toString('ascii', 8, 12) === 'WEBP';
    if ((input.mimeType === 'image/png' && !isPng) || (input.mimeType === 'image/jpeg' && !isJpeg) || (input.mimeType === 'image/webp' && !isWebp)) {
      return send(res, 400, { error: 'The photo file does not match its image type. Please choose it again.' });
    }
    const lookIndex = Number(input.look);
    if (!Number.isInteger(lookIndex) || lookIndex < 0 || lookIndex >= outfits.length) {
      return send(res, 400, { error: 'Choose one of the VELL outfits, then try again.' });
    }

    // Model enum is selected from the live service catalog; no model ID is assumed to exist.
    const models = await listModels();
    if (!models.length) return send(res, 503, { error: 'No image-editing models are available right now. Please retry later.' });
    const model = models.find(item => /gpt-image-2/i.test(`${item.id || ''} ${item.model || ''}`)) || models.find(item => typeof item.model === 'string') || models[0];
    if (!model || typeof model.model !== 'string') return send(res, 503, { error: 'The image service has no usable edit model right now. Please retry later.' });
    const outfit = outfits[lookIndex];
    const sourceUrl = `https://images.higgs.ai/?default=1&output=webp&url=${encodeURIComponent(`https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/${['hf_20261112_034542_a6430ecf-9862-412c-8ef6-5745115bd78c.png','hf_20261112_034738_73282737-acc8-41e9-a822-96c663e27b6c.png','hf_20261112_034742_9a8a92fd-79ae-4163-9ffa-14ae2a68717f.png','hf_20261112_034735_4e352e03-ad2b-44d1-9fcf-4b5b9454dc55.png','hf_20261112_034738_aeb8ea57-6399-4f3c-b54a-4a57d0bd971e.png','hf_20261112_034736_aace5c5f-8c14-4b00-83ba-744dbad2e337.png','hf_20261112_034735_3d9fb69e-b4e0-49f7-a2d4-e592bd616c27.png','hf_20261112_034740_3e3c5ad7-689b-46a2-8e09-c7d36a569b9c.png'][lookIndex]}`)}&w=1000&q=85`;
    const prompt = `Make one photorealistic virtual-clothing-try-on image edit. The first reference image is the user's real photograph and is the base image. The second reference image shows the target VELL outfit. Change the clothing worn by the person in the first photograph to this outfit: ${outfit.description} Match the target outfit's silhouette, colors, materials and styling as closely as practical. Preserve the exact real person's identity, facial features, skin tone, hairstyle, body proportions, pose, hands, camera angle, lighting, and original photographic setting. Keep the composition and all non-clothing content from the user's photo unchanged. Make the clothing naturally fit the person's actual body with realistic fabric folds, occlusion, shadows and perspective. Replace the garment pixels as part of a coherent photographic edit: do not add a clothing sticker, mask, cutout, collage, split-screen, outline, or UI. Do not copy the catalog model's face or body onto the user. Output only the edited photograph.`;
    const result = await connectCall('GenerateImage', {
      prompt,
      model: model.model,
      originalImages: [
        { b64Json: input.image, mimeType: input.mimeType },
        { url: sourceUrl, mimeType: 'image/webp' }
      ]
    });
    if (!result.image || (!result.image.b64Json && !result.image.url)) {
      return send(res, 502, { error: 'The image service returned no edited photo. Please retry.' });
    }
    send(res, 200, {
      imageData: result.image.b64Json || null,
      imageUrl: result.image.url || null,
      mimeType: result.image.mimeType || 'image/png'
    });
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 502;
    send(res, status, { error: error.message || 'The image service could not complete this try-on.' });
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true });
  if (pathname === '/api/try-on' && req.method === 'POST') {
    return tryOn(req, res);
  }
  if (pathname.startsWith('/api/')) return send(res, 404, { error: 'API route not found.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });

  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const fullPath = path.resolve(ROOT, relative);
  if (!fullPath.startsWith(ROOT + path.sep)) return send(res, 403, { error: 'Forbidden.' });
  fs.readFile(fullPath, (error, data) => {
    if (error) return send(res, 404, { error: 'Not found.' });
    const contentType = files[path.extname(fullPath)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType, 'content-length': data.length, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`VELL listening on ${PORT}`));
