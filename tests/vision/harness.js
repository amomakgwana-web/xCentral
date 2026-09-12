import * as image from '../../src/vision/image.js';
import * as face from '../../src/vision/face.js';
import * as depth from '../../src/vision/depth.js';
import * as docs from '../../src/vision/document.js';

window.V = { image, face, depth, docs };
window.__VISION_READY = true;
