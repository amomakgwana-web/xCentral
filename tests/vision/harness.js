import * as image from '../../src/vision/image.js';
import * as face from '../../src/vision/face.js';
import * as depth from '../../src/vision/depth.js';
import * as docs from '../../src/vision/document.js';
import * as pdf from '../../src/vision/pdf.js';
import * as fingerprint from '../../src/vision/fingerprint.js';
import * as scan from '../../src/vision/scan.js';
import { document_scan_rules, duplicate_thresholds } from '../../src/data/reference.js';

window.V = { image, face, depth, docs, pdf, fingerprint, scan, document_scan_rules, duplicate_thresholds };
window.__VISION_READY = true;
