/**
 * Helper functions for ExtendScript API
 * ExtendScript is the legacy scripting API for Photoshop
 */

import { jsString } from '../utils/js-string.js';

/**
 * Helper functions for character/string ID conversion
 */
const helperFunctions = `
function cTID(s) { return app.charIDToTypeID(s); }
function sTID(s) { return app.stringIDToTypeID(s); }
`;

/**
 * Resolve a display or PostScript font name to the PostScript name required by TextItem.font.
 * @see https://theiviaxx.github.io/photoshop-docs/Photoshop/TextItem/font.html
 * @see https://theiviaxx.github.io/photoshop-docs/Photoshop/TextFont.html
 */
const resolveFontPostScriptName = `
function resolveFontPostScriptName(name) {
  for (var i = 0; i < app.fonts.length; i++) {
    var f = app.fonts[i];
    try {
      if (f.postScriptName === name || f.name === name) {
        return f.postScriptName;
      }
    } catch (e) {}
  }
  return null;
}
`;

/**
 * Helper function to get current context information
 */
const getContextInfo = `
function getContextInfo() {
  var context = {
    hasDocument: app.documents.length > 0
  };
  
  if (context.hasDocument) {
    var doc = null;
    try {
      doc = app.activeDocument;
    } catch (e) {
      doc = null;
    }

    if (doc) {
      context.document = {};
      try { context.document.name = doc.name; } catch (e) {}
      try { context.document.width = doc.width.as('px'); } catch (e) {}
      try { context.document.height = doc.height.as('px'); } catch (e) {}
      try { context.document.resolution = doc.resolution; } catch (e) {}
      try { context.document.colorMode = String(doc.mode); } catch (e) {}
      try { context.document.layerCount = doc.layers.length; } catch (e) {}
      try {
        context.document.hasSelection = !!(doc.selection && doc.selection.bounds);
      } catch (e) {
        // ExtendScript throws "No such element" when there is no active selection
        context.document.hasSelection = false;
      }

      try {
        if (doc.activeLayer) {
          var layer = doc.activeLayer;
          context.activeLayer = {
            name: layer.name,
            kind: (layer.typename === 'LayerSet' ? 'LayerKind.GROUP' : String(layer.kind)),
            opacity: layer.opacity,
            blendMode: String(layer.blendMode),
            visible: layer.visible,
            locked: layer.allLocked
          };
          try {
            context.activeLayer.isBackground = layer.isBackgroundLayer;
          } catch (e) {
            context.activeLayer.isBackground = false;
          }
          try {
            var bounds = layer.bounds;
            context.activeLayer.bounds = {
              left: bounds[0].as('px'),
              top: bounds[1].as('px'),
              right: bounds[2].as('px'),
              bottom: bounds[3].as('px')
            };
          } catch (e) {
            // Bounds not available for some layer types
          }
        }
      } catch (e) {
        context.activeLayer = null;
      }
    }
  }
  
  return context;
}
`;

/** Curves adjustment layer helper — shared by atomics and recipes (uses __mcp_s2t / __mcp_c2t). */
export const MCP_CURVES_ADJUSTMENT_HELPER = `
function __mcp_makeCurvesAdjustmentLayer(preset) {
  var usePreset = preset || 'auto_tone';
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putClass(__mcp_s2t('adjustmentLayer'));
  desc.putReference(__mcp_s2t('null'), ref);
  var using = new ActionDescriptor();
  var curvesAdjust = new ActionDescriptor();
  var curvesAdjustments = new ActionList();
  var curvesPair = new ActionDescriptor();
  var curvesPoints = new ActionList();
  var ptBlack = new ActionDescriptor();
  var ptWhite = new ActionDescriptor();
  if (usePreset === 'neutral') {
    ptBlack.putDouble(__mcp_c2t('Hrzn'), 0);
    ptBlack.putDouble(__mcp_c2t('Vrtc'), 0);
    ptWhite.putDouble(__mcp_c2t('Hrzn'), 255);
    ptWhite.putDouble(__mcp_c2t('Vrtc'), 255);
  } else {
    ptBlack.putDouble(__mcp_c2t('Hrzn'), 12);
    ptBlack.putDouble(__mcp_c2t('Vrtc'), 0);
    ptWhite.putDouble(__mcp_c2t('Hrzn'), 243);
    ptWhite.putDouble(__mcp_c2t('Vrtc'), 255);
  }
  curvesPoints.putObject(__mcp_c2t('Pnt '), ptBlack);
  curvesPoints.putObject(__mcp_c2t('Pnt '), ptWhite);
  curvesPair.putList(__mcp_c2t('Crv '), curvesPoints);
  var channelRef = new ActionReference();
  channelRef.putEnumerated(__mcp_c2t('Chnl'), __mcp_c2t('Chnl'), __mcp_c2t('Cmps'));
  curvesPair.putReference(__mcp_c2t('Chnl'), channelRef);
  curvesAdjustments.putObject(__mcp_c2t('CrvA'), curvesPair);
  curvesAdjust.putList(__mcp_c2t('Adjs'), curvesAdjustments);
  using.putObject(__mcp_s2t('type'), __mcp_s2t('curves'), curvesAdjust);
  desc.putObject(__mcp_s2t('using'), __mcp_s2t('adjustmentLayer'), using);
  executeAction(__mcp_s2t('make'), desc, DialogModes.NO);
  return app.activeDocument.activeLayer;
}
`;

const mcpActionHelperAliases = `
function __mcp_s2t(s) { return sTID(s); }
function __mcp_c2t(s) { return cTID(s); }
`;

/**
 * §6.8 target-identity helpers (docs/design/transport-layer.md §6.8). Backend A
 * leans on doc.activeLayer, so to let layer-targeting commands bind to the layer
 * they MEAN — not whatever happens to be active — these resolve/activate a layer
 * by its native id (the same stable id the mutating snippets read back and return).
 *
 * __mcp_layerIdSafe(layer): read layer.id, returning null if unavailable so a
 * snippet can still succeed on a PS build where the property throws (defensive; the
 * property is reliable on PS 2026, used by getLayerNames' mask probe).
 *
 * __mcp_selectLayerById(id): make the layer with this id the active layer via an AM
 * 'slct' by identifier (the DOM has no getByID for layers). Mirrors the UXP
 * selectLayerByIdDescriptor so both backends resolve identity the same way. Throws
 * if the id does not resolve, so a bad id fails loud rather than mutating the wrong
 * layer — which is the entire point of the target-identity contract.
 */
const MCP_LAYER_IDENTITY_HELPERS = `
function __mcp_layerIdSafe(layer) {
  try { return layer.id; } catch (e) { return null; }
}
function __mcp_selectLayerById(layerId) {
  var ref = new ActionReference();
  ref.putIdentifier(charIDToTypeID('Lyr '), layerId);
  var desc = new ActionDescriptor();
  desc.putReference(charIDToTypeID('null'), ref);
  desc.putBoolean(charIDToTypeID('MkVs'), false);
  executeAction(charIDToTypeID('slct'), desc, DialogModes.NO);
  return app.activeDocument.activeLayer;
}
`;

/**
 * Layer mask helpers — Adobe Community / StackSupport.jsx patterns.
 * @see https://community.adobe.com/t5/photoshop-ecosystem-discussions/is-it-possible-to-make-a-layer-mask-with-the-current-selection-using-extendscript/td-p/10872052
 * @see https://github.com/LeZuse/photoshop-scripts/blob/master/default/Stack%20Scripts%20Only/StackSupport.jsx
 */
export const MCP_LAYER_MASK_HELPERS = `
function __mcp_hasLayerMaskAM() {
  var ref = new ActionReference();
  var args = new ActionDescriptor();
  ref.putProperty(cTID('Prpr'), cTID('UsrM'));
  ref.putEnumerated(cTID('Lyr '), cTID('Ordn'), cTID('Trgt'));
  args.putReference(cTID('null'), ref);
  try {
    var resultDesc = executeAction(cTID('getd'), args, DialogModes.NO);
    return resultDesc.hasKey(cTID('UsrM'));
  } catch (e) {
    return false;
  }
}

function __mcp_makeLayerMaskAtChannel(maskMode) {
  var desc = new ActionDescriptor();
  var atRef = new ActionReference();
  desc.putClass(sTID('new'), sTID('channel'));
  atRef.putEnumerated(sTID('channel'), sTID('channel'), sTID('mask'));
  desc.putReference(sTID('at'), atRef);
  desc.putEnumerated(sTID('using'), sTID('userMaskEnabled'), sTID(maskMode));
  executeAction(sTID('make'), desc, DialogModes.NO);
}

function __mcp_selectLayerMaskChannel() {
  var selRef = new ActionReference();
  selRef.putEnumerated(cTID('Chnl'), cTID('Ordn'), cTID('Trgt'));
  var selDesc = new ActionDescriptor();
  selDesc.putReference(cTID('null'), selRef);
  selDesc.putBoolean(cTID('MkVs'), true);
  executeAction(cTID('slct'), selDesc, DialogModes.NO);
}

function __mcp_pointDescPx(x, y) {
  var desc = new ActionDescriptor();
  desc.putUnitDouble(cTID('Hrzn'), cTID('#Pxl'), x);
  desc.putUnitDouble(cTID('Vrtc'), cTID('#Pxl'), y);
  return desc;
}

function __mcp_gradientStop(location, midPoint) {
  var desc = new ActionDescriptor();
  desc.putInteger(cTID('Lctn'), location);
  desc.putInteger(cTID('Mdpn'), midPoint);
  return desc;
}

function __mcp_grayColor(grayValue) {
  var desc = new ActionDescriptor();
  desc.putDouble(cTID('Gry '), grayValue);
  return desc;
}

/** Linear black-to-white gradient on the active mask channel (StackSupport.jsx pattern). */
function __mcp_gradientFillLayerMask(fromXPx, fromYPx, toXPx, toYPx, reverseGradient) {
  var args = new ActionDescriptor();
  args.putObject(cTID('From'), cTID('Pnt '), __mcp_pointDescPx(fromXPx, fromYPx));
  args.putObject(cTID('T   '), cTID('Pnt '), __mcp_pointDescPx(toXPx, toYPx));
  args.putEnumerated(cTID('Md  '), cTID('BlnM'), cTID('Nrml'));
  args.putEnumerated(cTID('Type'), cTID('GrdT'), cTID('Lnr '));
  args.putBoolean(cTID('Dthr'), true);
  args.putBoolean(cTID('UsMs'), true);
  args.putBoolean(cTID('Rvrs'), !!reverseGradient);

  var gradDesc = new ActionDescriptor();
  gradDesc.putString(cTID('Nm  '), 'Black, White');
  gradDesc.putEnumerated(cTID('GrdF'), cTID('GrdF'), cTID('CstS'));
  gradDesc.putDouble(cTID('Intr'), 4096.0);

  var colorList = new ActionList();
  var stopWhite = __mcp_gradientStop(0, 50);
  stopWhite.putObject(cTID('Clr '), cTID('Grsc'), __mcp_grayColor(100.0));
  stopWhite.putEnumerated(cTID('Type'), cTID('Clry'), cTID('UsrS'));
  colorList.putObject(cTID('Clrt'), stopWhite);
  var stopBlack = __mcp_gradientStop(4096, 50);
  stopBlack.putObject(cTID('Clr '), cTID('Grsc'), __mcp_grayColor(0.0));
  stopBlack.putEnumerated(cTID('Type'), cTID('Clry'), cTID('UsrS'));
  colorList.putObject(cTID('Clrt'), stopBlack);
  gradDesc.putList(cTID('Clrs'), colorList);

  var xferList = new ActionList();
  var xferA = __mcp_gradientStop(0, 50);
  xferA.putUnitDouble(cTID('Opct'), cTID('#Prc'), 100.0);
  xferList.putObject(cTID('TrnS'), xferA);
  var xferB = __mcp_gradientStop(4096, 50);
  xferB.putUnitDouble(cTID('Opct'), cTID('#Prc'), 100.0);
  xferList.putObject(cTID('TrnS'), xferB);
  gradDesc.putList(cTID('Trns'), xferList);

  args.putObject(cTID('Grad'), cTID('Grdn'), gradDesc);
  executeAction(cTID('Grdn'), args, DialogModes.NO);
}
`;

/**
 * Layer-style / FX (layer effects) helpers.
 *
 * Applies Photoshop layer effects (drop shadow, stroke, outer glow, color overlay,
 * inner shadow, bevel/emboss, gradient overlay) to the active layer by building a
 * `layerEffects` ActionDescriptor and running executeAction(sTID('set'), ...).
 *
 * Descriptor key structure and enum names are cribbed from the UXP batchPlay
 * reference (~/adb-mcp/uxp/ps/commands/layer_styles.js) — batchPlay JSON descriptors
 * translate 1:1 into these ActionDescriptor calls.
 *
 * MERGE BEHAVIOUR: __mcp_readLayerEffectsDesc() reads the layer's existing
 * `layerEffects` descriptor (via getd on the Lefx property) and mutates it in place,
 * so adding one effect preserves any effects already present (e.g. add_stroke after
 * add_drop_shadow keeps both). Re-applying the same effect type replaces just that
 * sub-effect.
 *
 * RGBColor QUIRK: the Action Manager RGBColor object uses the key `grain` for the
 * GREEN channel (not `green`) — this matches the batchPlay reference and is required
 * for the color to read correctly.
 *
 * Uses sTID/cTID which are provided by RECIPE_ACTION_HELPERS (the suspendHistory wrap).
 * @see https://community.adobe.com/t5/photoshop-ecosystem-discussions/scripting-layer-styles/td-p/10730575
 */
export const MCP_LAYER_STYLE_HELPERS = `
/** Map a friendly blend-mode name to its Action Manager blendMode enum string. */
function __mcp_blendModeStr(name) {
  var map = {
    NORMAL: 'normal', DISSOLVE: 'dissolve', DARKEN: 'darken', MULTIPLY: 'multiply',
    COLORBURN: 'colorBurn', LINEARBURN: 'linearBurn', DARKERCOLOR: 'darkerColor',
    LIGHTEN: 'lighten', SCREEN: 'screen', COLORDODGE: 'colorDodge',
    LINEARDODGE: 'linearDodge', LIGHTERCOLOR: 'lighterColor', OVERLAY: 'overlay',
    SOFTLIGHT: 'softLight', HARDLIGHT: 'hardLight', VIVIDLIGHT: 'vividLight',
    LINEARLIGHT: 'linearLight', PINLIGHT: 'pinLight', HARDMIX: 'hardMix',
    DIFFERENCE: 'difference', EXCLUSION: 'exclusion', SUBTRACT: 'blendSubtraction',
    DIVIDE: 'blendDivide', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color',
    LUMINOSITY: 'luminosity'
  };
  var key = String(name).toUpperCase();
  var v = map[key];
  if (!v) {
    throw new Error('Unknown blend mode "' + name + '". Valid: ' + __mcp_objectKeys(map).join(', '));
  }
  return v;
}

function __mcp_objectKeys(obj) {
  var out = [];
  for (var k in obj) { if (obj.hasOwnProperty(k)) out.push(k); }
  return out;
}

/** Throw a clear error unless the active document is in RGB color mode (layer effects require RGB). */
function __mcp_assertRgbForEffects() {
  var doc = app.activeDocument;
  if (doc.mode !== DocumentMode.RGB) {
    throw new Error(
      'Layer effects require an RGB document. Active document mode is ' +
      String(doc.mode) + '. Convert to RGB (Image > Mode > RGB Color) first.'
    );
  }
}

/** Build an RGBColor descriptor. NOTE: green channel uses key "grain" (AM quirk). */
function __mcp_rgbColorDesc(red, green, blue) {
  var c = new ActionDescriptor();
  c.putDouble(sTID('red'), red);
  c.putDouble(sTID('grain'), green);
  c.putDouble(sTID('blue'), blue);
  return c;
}

/** Clamp a numeric value to [min, max]. */
function __mcp_clampNum(v, min, max) {
  if (typeof v !== 'number' || isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * Read the active layer's existing layerEffects descriptor so new effects merge with
 * any already present. Returns a fresh ActionDescriptor if the layer has no effects.
 */
function __mcp_readLayerEffectsDesc() {
  var ref = new ActionReference();
  ref.putProperty(sTID('property'), sTID('layerEffects'));
  ref.putEnumerated(sTID('layer'), sTID('ordinal'), sTID('targetEnum'));
  var getDesc = new ActionDescriptor();
  getDesc.putReference(sTID('null'), ref);
  try {
    var layerDesc = executeAction(sTID('get'), getDesc, DialogModes.NO);
    if (layerDesc.hasKey(sTID('layerEffects'))) {
      return layerDesc.getObjectValue(sTID('layerEffects'));
    }
  } catch (eRead) {
    // No existing effects (or layer type without effects) — start fresh.
  }
  var fresh = new ActionDescriptor();
  fresh.putUnitDouble(sTID('scale'), sTID('percentUnit'), 100.0);
  return fresh;
}

/** Apply the assembled layerEffects descriptor to the active layer via set. */
function __mcp_setLayerEffects(fxDesc) {
  var setDesc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putProperty(sTID('property'), sTID('layerEffects'));
  ref.putEnumerated(sTID('layer'), sTID('ordinal'), sTID('targetEnum'));
  setDesc.putReference(sTID('null'), ref);
  setDesc.putObject(sTID('to'), sTID('layerEffects'), fxDesc);
  executeAction(sTID('set'), setDesc, DialogModes.NO);
}

/** Assert an active raster/text/smart-object layer (not a group) is selected. */
function __mcp_assertEffectableLayer() {
  var doc = app.activeDocument;
  var layer = doc.activeLayer;
  if (!layer) {
    throw new Error('No active layer. Select a layer first.');
  }
  if (layer.typename === 'LayerSet') {
    throw new Error('Layer effects cannot be applied to a layer group. Select a normal, text, or smart-object layer.');
  }
  return layer;
}

/** dropShadow sub-descriptor (opts: red, green, blue, opacity, angle, distance, size, spread, blendMode). */
function __mcp_buildDropShadow(opts) {
  var d = new ActionDescriptor();
  d.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_blendModeStr(opts.blendMode)));
  d.putObject(sTID('color'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.red, opts.green, opts.blue));
  d.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_clampNum(opts.opacity, 0, 100));
  d.putUnitDouble(sTID('localLightingAngle'), sTID('angleUnit'), opts.angle);
  d.putBoolean(sTID('useGlobalAngle'), false);
  d.putUnitDouble(sTID('distance'), sTID('pixelsUnit'), Math.max(0, opts.distance));
  d.putUnitDouble(sTID('chokeMatte'), sTID('pixelsUnit'), __mcp_clampNum(opts.spread, 0, 100));
  d.putUnitDouble(sTID('blur'), sTID('pixelsUnit'), Math.max(0, opts.size));
  d.putUnitDouble(sTID('noise'), sTID('percentUnit'), 0.0);
  d.putBoolean(sTID('antiAlias'), false);
  var transferSpec = new ActionDescriptor();
  transferSpec.putString(sTID('name'), 'Linear');
  d.putObject(sTID('transferSpec'), sTID('shapeCurveType'), transferSpec);
  d.putBoolean(sTID('layerConceals'), true);
  d.putBoolean(sTID('enabled'), true);
  d.putBoolean(sTID('present'), true);
  d.putBoolean(sTID('showInDialog'), true);
  return d;
}

/** innerShadow sub-descriptor (same opts shape as drop shadow). */
function __mcp_buildInnerShadow(opts) {
  var d = new ActionDescriptor();
  d.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_blendModeStr(opts.blendMode)));
  d.putObject(sTID('color'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.red, opts.green, opts.blue));
  d.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_clampNum(opts.opacity, 0, 100));
  d.putUnitDouble(sTID('localLightingAngle'), sTID('angleUnit'), opts.angle);
  d.putBoolean(sTID('useGlobalAngle'), false);
  d.putUnitDouble(sTID('distance'), sTID('pixelsUnit'), Math.max(0, opts.distance));
  d.putUnitDouble(sTID('chokeMatte'), sTID('pixelsUnit'), __mcp_clampNum(opts.spread, 0, 100));
  d.putUnitDouble(sTID('blur'), sTID('pixelsUnit'), Math.max(0, opts.size));
  d.putUnitDouble(sTID('noise'), sTID('percentUnit'), 0.0);
  d.putBoolean(sTID('antiAlias'), false);
  var transferSpec = new ActionDescriptor();
  transferSpec.putString(sTID('name'), 'Linear');
  d.putObject(sTID('transferSpec'), sTID('shapeCurveType'), transferSpec);
  d.putBoolean(sTID('enabled'), true);
  d.putBoolean(sTID('present'), true);
  d.putBoolean(sTID('showInDialog'), true);
  return d;
}

/** frameFX (stroke) sub-descriptor (opts: size, position, red, green, blue, opacity, blendMode). */
function __mcp_buildStroke(opts) {
  var position = 'centeredFrame';
  var p = String(opts.position || 'outside').toLowerCase();
  if (p === 'inside') { position = 'insetFrame'; }
  else if (p === 'outside') { position = 'outsetFrame'; }
  else if (p === 'center') { position = 'centeredFrame'; }
  var d = new ActionDescriptor();
  d.putEnumerated(sTID('style'), sTID('frameStyle'), sTID(position));
  d.putEnumerated(sTID('paintType'), sTID('frameFill'), sTID('solidColor'));
  d.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_blendModeStr(opts.blendMode)));
  d.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_clampNum(opts.opacity, 0, 100));
  d.putUnitDouble(sTID('size'), sTID('pixelsUnit'), Math.max(0, opts.size));
  d.putObject(sTID('color'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.red, opts.green, opts.blue));
  d.putBoolean(sTID('overprint'), false);
  d.putBoolean(sTID('enabled'), true);
  d.putBoolean(sTID('present'), true);
  d.putBoolean(sTID('showInDialog'), true);
  return d;
}

/** outerGlow sub-descriptor (opts: red, green, blue, opacity, size, spread, blendMode). */
function __mcp_buildOuterGlow(opts) {
  var d = new ActionDescriptor();
  d.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_blendModeStr(opts.blendMode)));
  d.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_clampNum(opts.opacity, 0, 100));
  d.putUnitDouble(sTID('noise'), sTID('percentUnit'), 0.0);
  d.putEnumerated(sTID('glowTechnique'), sTID('matteTechnique'), sTID('softMatte'));
  d.putObject(sTID('color'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.red, opts.green, opts.blue));
  d.putUnitDouble(sTID('chokeMatte'), sTID('pixelsUnit'), __mcp_clampNum(opts.spread, 0, 100));
  d.putUnitDouble(sTID('blur'), sTID('pixelsUnit'), Math.max(0, opts.size));
  d.putUnitDouble(sTID('inputRange'), sTID('percentUnit'), 50.0);
  d.putUnitDouble(sTID('shadingNoise'), sTID('percentUnit'), 0.0);
  d.putBoolean(sTID('antiAlias'), false);
  var transferSpec = new ActionDescriptor();
  transferSpec.putString(sTID('name'), 'Linear');
  d.putObject(sTID('transferSpec'), sTID('shapeCurveType'), transferSpec);
  d.putBoolean(sTID('enabled'), true);
  d.putBoolean(sTID('present'), true);
  d.putBoolean(sTID('showInDialog'), true);
  return d;
}

/** solidFill (color overlay) sub-descriptor (opts: red, green, blue, opacity, blendMode). */
function __mcp_buildColorOverlay(opts) {
  var d = new ActionDescriptor();
  d.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_blendModeStr(opts.blendMode)));
  d.putObject(sTID('color'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.red, opts.green, opts.blue));
  d.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_clampNum(opts.opacity, 0, 100));
  d.putBoolean(sTID('enabled'), true);
  d.putBoolean(sTID('present'), true);
  d.putBoolean(sTID('showInDialog'), true);
  return d;
}

/** bevelEmboss sub-descriptor (opts: style, depth, size, soften, angle, altitude, highlight/shadow color+opacity+blend). */
function __mcp_buildBevelEmboss(opts) {
  var styleMap = {
    outerBevel: 'outerBevel', innerBevel: 'innerBevel', emboss: 'emboss',
    pillowEmboss: 'pillowEmboss', strokeEmboss: 'strokeEmboss'
  };
  var bevelStyle = styleMap[opts.style] || 'innerBevel';
  var d = new ActionDescriptor();
  d.putEnumerated(sTID('bevelStyle'), sTID('bevelEmbossStyle'), sTID(bevelStyle));
  d.putEnumerated(sTID('bevelTechnique'), sTID('bevelEmbossTechnique'), sTID('softMatte'));
  d.putUnitDouble(sTID('strengthRatio'), sTID('percentUnit'), __mcp_clampNum(opts.depth, 1, 1000));
  d.putEnumerated(sTID('bevelDirection'), sTID('bevelEmbossStampStyle'), sTID('in'));
  d.putUnitDouble(sTID('blur'), sTID('pixelsUnit'), Math.max(0, opts.size));
  d.putUnitDouble(sTID('softness'), sTID('pixelsUnit'), Math.max(0, opts.soften));
  d.putBoolean(sTID('useGlobalAngle'), false);
  d.putUnitDouble(sTID('localLightingAngle'), sTID('angleUnit'), opts.angle);
  d.putUnitDouble(sTID('localLightingAltitude'), sTID('angleUnit'), __mcp_clampNum(opts.altitude, 0, 90));
  var highlightTransfer = new ActionDescriptor();
  highlightTransfer.putString(sTID('name'), 'Linear');
  d.putObject(sTID('transferSpec'), sTID('shapeCurveType'), highlightTransfer);
  d.putBoolean(sTID('antiAlias'), false);
  d.putEnumerated(sTID('highlightMode'), sTID('blendMode'), sTID(__mcp_blendModeStr(opts.highlightBlendMode)));
  d.putObject(sTID('highlightColor'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.highlightRed, opts.highlightGreen, opts.highlightBlue));
  d.putUnitDouble(sTID('highlightOpacity'), sTID('percentUnit'), __mcp_clampNum(opts.highlightOpacity, 0, 100));
  d.putEnumerated(sTID('shadowMode'), sTID('blendMode'), sTID(__mcp_blendModeStr(opts.shadowBlendMode)));
  d.putObject(sTID('shadowColor'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.shadowRed, opts.shadowGreen, opts.shadowBlue));
  d.putUnitDouble(sTID('shadowOpacity'), sTID('percentUnit'), __mcp_clampNum(opts.shadowOpacity, 0, 100));
  d.putBoolean(sTID('enabled'), true);
  d.putBoolean(sTID('present'), true);
  d.putBoolean(sTID('showInDialog'), true);
  return d;
}

/** Two-color gradientLayer descriptor (black->white style) for a gradient overlay. */
function __mcp_buildGradientOverlay(opts) {
  var d = new ActionDescriptor();
  d.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_blendModeStr(opts.blendMode)));
  d.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_clampNum(opts.opacity, 0, 100));
  var gradient = new ActionDescriptor();
  gradient.putString(sTID('name'), 'Custom');
  gradient.putEnumerated(sTID('gradientForm'), sTID('gradientForm'), sTID('customStops'));
  gradient.putDouble(sTID('interfaceIconFrameDimmed'), 4096.0);

  var colors = new ActionList();
  var startStop = new ActionDescriptor();
  startStop.putObject(sTID('color'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.startRed, opts.startGreen, opts.startBlue));
  startStop.putEnumerated(sTID('type'), sTID('colorStopType'), sTID('userStop'));
  startStop.putInteger(sTID('location'), 0);
  startStop.putInteger(sTID('midpoint'), 50);
  colors.putObject(sTID('colorStop'), startStop);
  var endStop = new ActionDescriptor();
  endStop.putObject(sTID('color'), sTID('RGBColor'), __mcp_rgbColorDesc(opts.endRed, opts.endGreen, opts.endBlue));
  endStop.putEnumerated(sTID('type'), sTID('colorStopType'), sTID('userStop'));
  endStop.putInteger(sTID('location'), 4096);
  endStop.putInteger(sTID('midpoint'), 50);
  colors.putObject(sTID('colorStop'), endStop);
  gradient.putList(sTID('colors'), colors);

  var transparency = new ActionList();
  var startOpacity = new ActionDescriptor();
  startOpacity.putUnitDouble(sTID('opacity'), sTID('percentUnit'), 100.0);
  startOpacity.putInteger(sTID('location'), 0);
  startOpacity.putInteger(sTID('midpoint'), 50);
  transparency.putObject(sTID('transferSpec'), startOpacity);
  var endOpacity = new ActionDescriptor();
  endOpacity.putUnitDouble(sTID('opacity'), sTID('percentUnit'), 100.0);
  endOpacity.putInteger(sTID('location'), 4096);
  endOpacity.putInteger(sTID('midpoint'), 50);
  transparency.putObject(sTID('transferSpec'), endOpacity);
  gradient.putList(sTID('transparency'), transparency);

  d.putObject(sTID('gradient'), sTID('gradientClassEvent'), gradient);
  d.putEnumerated(sTID('type'), sTID('gradientType'), sTID('linear'));
  d.putBoolean(sTID('reverse'), false);
  d.putBoolean(sTID('dither'), false);
  d.putBoolean(sTID('align'), true);
  d.putUnitDouble(sTID('angle'), sTID('angleUnit'), opts.angle);
  d.putUnitDouble(sTID('scale'), sTID('percentUnit'), __mcp_clampNum(opts.scale, 10, 150));
  d.putBoolean(sTID('enabled'), true);
  d.putBoolean(sTID('present'), true);
  d.putBoolean(sTID('showInDialog'), true);
  return d;
}

/**
 * Apply one layer effect to the active layer, merging with existing effects.
 * effectKey is the layerEffects sub-key (e.g. 'dropShadow', 'frameFX', 'outerGlow',
 * 'solidFill', 'innerShadow', 'bevelEmboss', 'gradientFill'); subDesc is the built
 * sub-descriptor. globalAngle (optional) also sets the doc's global lighting angle.
 */
function __mcp_applyLayerEffect(effectKey, subDesc, globalAngle) {
  __mcp_assertRgbForEffects();
  var layer = __mcp_assertEffectableLayer();
  var fx = __mcp_readLayerEffectsDesc();
  // Sub-effect object type equals the effect key for every layer effect (dropShadow,
  // innerShadow, outerGlow, bevelEmboss, frameFX, solidFill, gradientFill). Note:
  // the Gradient OVERLAY effect is 'gradientFill' — NOT 'gradientLayer', which is the
  // separate content-layer gradient-fill class.
  fx.putObject(sTID(effectKey), sTID(effectKey), subDesc);
  if (typeof globalAngle === 'number') {
    fx.putUnitDouble(sTID('globalLightingAngle'), sTID('angleUnit'), globalAngle);
  }
  __mcp_setLayerEffects(fx);
  return layer.name;
}
`;

/**
 * Adjustment-layer helpers — create NON-DESTRUCTIVE adjustment layers above the
 * active layer via the "Make adjustmentLayer" Action Manager pattern:
 * executeAction(sTID('make'), desc, DialogModes.NO) where desc.using -> object
 * (class adjustmentLayer) -> key `type` -> the per-adjustment descriptor.
 *
 * Descriptor shapes are cribbed from the UXP batchPlay reference
 * (~/adb-mcp/uxp/ps/commands/adjustment_layers.js) for black&white / vibrance /
 * colorBalance, and from Photoshop ScriptingListener captures for curves / levels /
 * gradientMapClass / selectiveColor / photoFilter. batchPlay JSON descriptors map
 * 1:1 onto these ActionDescriptor putX calls.
 *
 * RGBColor QUIRK: the Action Manager RGBColor object uses key `grain` for the GREEN
 * channel (not `green`) — same quirk as the layer-style helpers.
 *
 * Uses sTID/cTID/__mcp_s2t/__mcp_c2t which are provided by RECIPE_ACTION_HELPERS
 * (the suspendHistory wrap). Every tool creates exactly ONE adjustment layer, so the
 * suspendHistory scope collapses it to a single undo.
 */
export const MCP_ADJUSTMENT_LAYER_HELPERS = `
/** Throw a clear error unless the active document is RGB (adjustment layers assume RGB channels). */
function __mcp_assertRgbForAdjustment() {
  if (app.documents.length === 0) {
    throw new Error('No active document. Open or create a document first.');
  }
  var doc = app.activeDocument;
  if (doc.mode !== DocumentMode.RGB) {
    throw new Error(
      'This adjustment layer requires an RGB document. Active document mode is ' +
      String(doc.mode) + '. Convert to RGB (Image > Mode > RGB Color) first.'
    );
  }
}

/** Assert a document exists (adjustment layers that work in any color mode). */
function __mcp_assertDocForAdjustment() {
  if (app.documents.length === 0) {
    throw new Error('No active document. Open or create a document first.');
  }
}

/** Build an RGBColor descriptor. NOTE: green channel uses key "grain" (AM quirk). */
function __mcp_adjRgbColor(red, green, blue) {
  var c = new ActionDescriptor();
  c.putDouble(sTID('red'), red);
  c.putDouble(sTID('grain'), green);
  c.putDouble(sTID('blue'), blue);
  return c;
}

/**
 * Run the standard "Make adjustmentLayer" executeAction given a type descriptor
 * and its type stringID. Returns the newly-created adjustment layer's name.
 */
function __mcp_makeAdjustmentLayer(typeStringId, typeDesc) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putClass(sTID('adjustmentLayer'));
  desc.putReference(sTID('null'), ref);
  var using = new ActionDescriptor();
  using.putObject(sTID('type'), sTID(typeStringId), typeDesc);
  desc.putObject(sTID('using'), sTID('adjustmentLayer'), using);
  executeAction(sTID('make'), desc, DialogModes.NO);
  return app.activeDocument.activeLayer.name;
}

/** Map a channel name to the curves/levels channel ActionReference. */
function __mcp_channelRef(channelName) {
  var ref = new ActionReference();
  var name = String(channelName || 'composite').toLowerCase();
  if (name === 'red') {
    ref.putEnumerated(cTID('Chnl'), cTID('Chnl'), cTID('Rd  '));
  } else if (name === 'green') {
    ref.putEnumerated(cTID('Chnl'), cTID('Chnl'), cTID('Grn '));
  } else if (name === 'blue') {
    ref.putEnumerated(cTID('Chnl'), cTID('Chnl'), cTID('Bl  '));
  } else {
    ref.putEnumerated(cTID('Chnl'), cTID('Chnl'), cTID('Cmps'));
  }
  return ref;
}

/**
 * Curves adjustment layer with arbitrary points on one channel.
 * points: array of { input: 0-255, output: 0-255 } (already sorted/clamped by TS).
 */
function __mcp_makeCurvesPointsLayer(channelName, points) {
  var curvesAdjust = new ActionDescriptor();
  var adjustments = new ActionList();
  var pair = new ActionDescriptor();
  var pointList = new ActionList();
  for (var i = 0; i < points.length; i++) {
    var pt = new ActionDescriptor();
    pt.putDouble(cTID('Hrzn'), points[i].input);
    pt.putDouble(cTID('Vrtc'), points[i].output);
    pointList.putObject(cTID('Pnt '), pt);
  }
  pair.putList(cTID('Crv '), pointList);
  pair.putReference(cTID('Chnl'), __mcp_channelRef(channelName));
  adjustments.putObject(cTID('CrvA'), pair);
  curvesAdjust.putList(cTID('Adjs'), adjustments);
  return __mcp_makeAdjustmentLayer('curves', curvesAdjust);
}

/**
 * Levels adjustment layer on one channel.
 * inputBlack/inputWhite 0-255, gamma 0.1-9.99, outputBlack/outputWhite 0-255.
 */
function __mcp_makeLevelsLayer(channelName, inputBlack, inputWhite, gamma, outputBlack, outputWhite) {
  var levelsDesc = new ActionDescriptor();
  levelsDesc.putEnumerated(sTID('presetKind'), sTID('presetKindType'), sTID('presetKindCustom'));
  var adjustments = new ActionList();
  var entry = new ActionDescriptor();
  entry.putReference(sTID('channel'), __mcp_channelRef(channelName));
  var inputList = new ActionList();
  inputList.putInteger(inputBlack);
  inputList.putInteger(inputWhite);
  entry.putList(sTID('input'), inputList);
  entry.putDouble(sTID('gamma'), gamma);
  var outputList = new ActionList();
  outputList.putInteger(outputBlack);
  outputList.putInteger(outputWhite);
  entry.putList(sTID('output'), outputList);
  adjustments.putObject(sTID('levelsAdjustment'), entry);
  levelsDesc.putList(sTID('adjustment'), adjustments);
  return __mcp_makeAdjustmentLayer('levels', levelsDesc);
}

/**
 * Gradient Map adjustment layer from a start color to an end color.
 * reverse flips the gradient. Colors are {r,g,b} 0-255.
 */
function __mcp_makeGradientMapLayer(startR, startG, startB, endR, endG, endB, reverse, dither) {
  var typeDesc = new ActionDescriptor();
  var gradient = new ActionDescriptor();
  gradient.putString(sTID('name'), 'Custom');
  gradient.putEnumerated(sTID('gradientForm'), sTID('gradientForm'), sTID('customStops'));
  gradient.putDouble(sTID('interfaceIconFrameDimmed'), 4096.0);

  var colors = new ActionList();
  var startStop = new ActionDescriptor();
  startStop.putObject(sTID('color'), sTID('RGBColor'), __mcp_adjRgbColor(startR, startG, startB));
  startStop.putEnumerated(sTID('type'), sTID('colorStopType'), sTID('userStop'));
  startStop.putInteger(sTID('location'), 0);
  startStop.putInteger(sTID('midpoint'), 50);
  colors.putObject(sTID('colorStop'), startStop);
  var endStop = new ActionDescriptor();
  endStop.putObject(sTID('color'), sTID('RGBColor'), __mcp_adjRgbColor(endR, endG, endB));
  endStop.putEnumerated(sTID('type'), sTID('colorStopType'), sTID('userStop'));
  endStop.putInteger(sTID('location'), 4096);
  endStop.putInteger(sTID('midpoint'), 50);
  colors.putObject(sTID('colorStop'), endStop);
  gradient.putList(sTID('colors'), colors);

  var transparency = new ActionList();
  var startOpacity = new ActionDescriptor();
  startOpacity.putUnitDouble(sTID('opacity'), sTID('percentUnit'), 100.0);
  startOpacity.putInteger(sTID('location'), 0);
  startOpacity.putInteger(sTID('midpoint'), 50);
  transparency.putObject(sTID('transferSpec'), startOpacity);
  var endOpacity = new ActionDescriptor();
  endOpacity.putUnitDouble(sTID('opacity'), sTID('percentUnit'), 100.0);
  endOpacity.putInteger(sTID('location'), 4096);
  endOpacity.putInteger(sTID('midpoint'), 50);
  transparency.putObject(sTID('transferSpec'), endOpacity);
  gradient.putList(sTID('transparency'), transparency);

  typeDesc.putObject(sTID('gradient'), sTID('gradientClassEvent'), gradient);
  typeDesc.putBoolean(sTID('reverse'), !!reverse);
  typeDesc.putBoolean(sTID('dither'), !!dither);
  return __mcp_makeAdjustmentLayer('gradientMapClass', typeDesc);
}

/** Map a selective-color target name to its colors enum stringID. */
function __mcp_selectiveColorEnum(target) {
  var map = {
    reds: 'reds', yellows: 'yellows', greens: 'greens', cyans: 'cyans',
    blues: 'blues', magentas: 'magentas', whites: 'whites',
    neutrals: 'neutrals', blacks: 'blacks'
  };
  var key = String(target || 'reds').toLowerCase();
  return map[key] || 'reds';
}

/**
 * Selective Color adjustment layer adjusting ONE target color band.
 * cyan/magenta/yellow/black are -100..100 percent. relative=true uses the
 * relative method, false uses absolute.
 */
function __mcp_makeSelectiveColorLayer(target, cyan, magenta, yellow, black, relative) {
  var typeDesc = new ActionDescriptor();
  typeDesc.putEnumerated(sTID('presetKind'), sTID('presetKindType'), sTID('presetKindCustom'));
  // Method: emit the ScriptingListener-canonical charID form (Mthd / Crrc / Abs |Rltv).
  // This is the reliable form; omitting or mis-typing it makes PS silently fall back to
  // Relative — the known "selective color reverts to Relative" bug.
  typeDesc.putEnumerated(cTID('Mthd'), cTID('Crrc'), cTID(relative ? 'Rltv' : 'Abs '));
  var correctionList = new ActionList();
  var entry = new ActionDescriptor();
  entry.putEnumerated(sTID('colors'), sTID('colors'), sTID(__mcp_selectiveColorEnum(target)));
  entry.putUnitDouble(sTID('cyan'), sTID('percentUnit'), cyan);
  entry.putUnitDouble(sTID('magenta'), sTID('percentUnit'), magenta);
  entry.putUnitDouble(sTID('yellowColor'), sTID('percentUnit'), yellow);
  entry.putUnitDouble(sTID('black'), sTID('percentUnit'), black);
  correctionList.putObject(sTID('colorCorrection'), entry);
  typeDesc.putList(sTID('colorCorrection'), correctionList);
  return __mcp_makeAdjustmentLayer('selectiveColor', typeDesc);
}

/**
 * Photo Filter adjustment layer.
 * useColor true -> custom RGB color; false -> named preset via presetId.
 * density 0-100, preserveLuminosity boolean.
 */
function __mcp_makePhotoFilterLayer(useColor, red, green, blue, density, preserveLuminosity) {
  var typeDesc = new ActionDescriptor();
  if (useColor) {
    typeDesc.putObject(sTID('color'), sTID('RGBColor'), __mcp_adjRgbColor(red, green, blue));
  } else {
    // Fallback: warming filter (85) preset color if no color supplied.
    typeDesc.putObject(sTID('color'), sTID('RGBColor'), __mcp_adjRgbColor(red, green, blue));
  }
  typeDesc.putInteger(sTID('density'), density);
  typeDesc.putBoolean(sTID('preserveLuminosity'), !!preserveLuminosity);
  return __mcp_makeAdjustmentLayer('photoFilter', typeDesc);
}

/**
 * Vibrance adjustment layer. vibrance/saturation are -100..100.
 * Crib: adb-mcp addAdjustmentLayerVibrance — this one uses the two-step
 * make(empty vibrance class) + set(values) path (the reference's proven shape),
 * unlike the other adjustments which populate values in the make descriptor.
 */
function __mcp_makeVibranceLayer(vibrance, saturation) {
  // Step 1: make an empty Vibrance adjustment layer (type is a bare class ref).
  var makeDesc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putClass(sTID('adjustmentLayer'));
  makeDesc.putReference(sTID('null'), ref);
  var using = new ActionDescriptor();
  using.putClass(sTID('type'), sTID('vibrance'));
  makeDesc.putObject(sTID('using'), sTID('adjustmentLayer'), using);
  executeAction(sTID('make'), makeDesc, DialogModes.NO);
  var layerName = app.activeDocument.activeLayer.name;

  // Step 2: set the vibrance/saturation values on the new adjustment layer.
  var setDesc = new ActionDescriptor();
  var setRef = new ActionReference();
  setRef.putEnumerated(sTID('adjustmentLayer'), sTID('ordinal'), sTID('targetEnum'));
  setDesc.putReference(sTID('null'), setRef);
  var valuesDesc = new ActionDescriptor();
  valuesDesc.putInteger(sTID('vibrance'), vibrance);
  valuesDesc.putInteger(sTID('saturation'), saturation);
  setDesc.putObject(sTID('to'), sTID('vibrance'), valuesDesc);
  executeAction(sTID('set'), setDesc, DialogModes.NO);
  return layerName;
}

/**
 * Color Balance adjustment layer. Each of shadows/midtones/highlights is a
 * 3-int array [cyanRed, magentaGreen, yellowBlue], -100..100.
 * Crib: adb-mcp addColorBalanceAdjustmentLayer.
 */
function __mcp_makeColorBalanceLayer(shadows, midtones, highlights, preserveLuminosity) {
  var typeDesc = new ActionDescriptor();
  function levelsList(arr) {
    var l = new ActionList();
    l.putInteger(arr[0]);
    l.putInteger(arr[1]);
    l.putInteger(arr[2]);
    return l;
  }
  typeDesc.putList(sTID('shadowLevels'), levelsList(shadows));
  typeDesc.putList(sTID('midtoneLevels'), levelsList(midtones));
  typeDesc.putList(sTID('highlightLevels'), levelsList(highlights));
  typeDesc.putBoolean(sTID('preserveLuminosity'), !!preserveLuminosity);
  return __mcp_makeAdjustmentLayer('colorBalance', typeDesc);
}

/**
 * Black & White adjustment layer. colors holds per-channel mix (red/yellow/green/
 * cyan/blue/magenta), -200..300. tint applies an RGB tintColor when useTint true.
 * Crib: adb-mcp addAdjustmentLayerBlackAndWhite.
 */
function __mcp_makeBlackWhiteLayer(colors, useTint, tintR, tintG, tintB) {
  var typeDesc = new ActionDescriptor();
  typeDesc.putEnumerated(sTID('presetKind'), sTID('presetKindType'), sTID('presetKindDefault'));
  typeDesc.putInteger(sTID('red'), colors.red);
  typeDesc.putInteger(sTID('yellow'), colors.yellow);
  typeDesc.putInteger(sTID('grain'), colors.green);
  typeDesc.putInteger(sTID('cyan'), colors.cyan);
  typeDesc.putInteger(sTID('blue'), colors.blue);
  typeDesc.putInteger(sTID('magenta'), colors.magenta);
  typeDesc.putBoolean(sTID('useTint'), !!useTint);
  typeDesc.putObject(sTID('tintColor'), sTID('RGBColor'), __mcp_adjRgbColor(tintR, tintG, tintB));
  return __mcp_makeAdjustmentLayer('blackAndWhite', typeDesc);
}
`;

/**
 * Filter Gallery / Distort / Stylize / Pixelate / Render / Blur dispatcher.
 *
 * `__mcp_applyFilter(name, params)` applies one filter to the ACTIVE LAYER and
 * returns the layer name. It prefers the ArtLayer DOM `apply*` method where one
 * exists (twirl, ripple, glowing edges, mosaic, clouds, …) and falls back to a
 * fixed Action Manager descriptor via executeAction where the DOM has no method
 * (shear, box/surface/shape blur, lens blur, wave, ocean ripple, glass).
 *
 * Assumes the shared AM helpers (__mcp_s2t / __mcp_c2t / __mcp_ensureRasterActiveLayer)
 * from RECIPE_ACTION_HELPERS are already in scope — this block is only ever run
 * through executeRecipe(), which prepends them.
 *
 * Raster-only: __mcp_ensureRasterActiveLayer rasterizes text/smart-object layers
 * and throws on layer groups, matching the existing dedicated filter tools.
 */
export const MCP_FILTER_GALLERY_HELPER = `
function __mcp_filterAction(eventStr, desc) {
  executeAction(__mcp_s2t(eventStr), desc, DialogModes.NO);
}

// Distort > Shear, Wave, Ocean Ripple, Glass and Blur > Lens Blur all HAVE ArtLayer DOM
// methods (verified against the Photoshop ExtendScript reference), so they are called
// directly in __mcp_applyFilter below rather than via hand-built descriptors. Only
// Box / Surface / Shape Blur lack a DOM method and keep an executeAction descriptor here.

/** Blur > Box Blur — no DOM method; AM descriptor. */
function __mcp_applyBoxBlur(radius) {
  var d = new ActionDescriptor();
  d.putUnitDouble(__mcp_s2t('radius'), __mcp_s2t('pixelsUnit'), radius);
  __mcp_filterAction('boxBlur', d);
}

/** Blur > Surface Blur — no DOM method; AM descriptor. */
function __mcp_applySurfaceBlur(radius, threshold) {
  var d = new ActionDescriptor();
  d.putUnitDouble(__mcp_s2t('radius'), __mcp_s2t('pixelsUnit'), radius);
  d.putInteger(__mcp_s2t('threshold'), threshold);
  __mcp_filterAction('surfaceBlur', d);
}

/**
 * Blur > Shape Blur — no DOM method; AM descriptor. Uses the built-in "Ellipse 1" custom
 * shape as the kernel. NOTE: the exact shape descriptor is unverified without a
 * ScriptingListener capture; if the named preset is absent this throws and the
 * suspendHistory scope rolls back cleanly. Flagged for live verification.
 */
function __mcp_applyShapeBlur(radius) {
  var d = new ActionDescriptor();
  d.putUnitDouble(__mcp_s2t('radius'), __mcp_s2t('pixelsUnit'), radius);
  d.putString(__mcp_s2t('name'), 'Ellipse 1');
  d.putBoolean(__mcp_s2t('custom'), false);
  __mcp_filterAction('shapeBlur', d);
}

/** Map a friendly spherize mode to the DOM SpherizeMode enum. */
function __mcp_spherizeMode(mode) {
  if (mode === 'horizontal') return SpherizeMode.HORIZONTAL;
  if (mode === 'vertical') return SpherizeMode.VERTICAL;
  return SpherizeMode.NORMAL;
}

function __mcp_polarConversion(conversion) {
  return (conversion === 'polar_to_rect')
    ? PolarConversionType.POLARTORECTANGULAR
    : PolarConversionType.RECTANGULARTOPOLAR;
}

function __mcp_zigZagType(style) {
  if (style === 'around_center') return ZigZagType.AROUNDCENTER;
  if (style === 'out_from_center') return ZigZagType.OUTFROMCENTER;
  return ZigZagType.PONDRIPPLES;
}

function __mcp_radialBlurMethod(method) {
  return (method === 'zoom') ? RadialBlurMethod.ZOOM : RadialBlurMethod.SPIN;
}

/** Map a friendly lens-flare lens name to the DOM LensType enum (member names differ from friendly ones). */
function __mcp_lensType(lensType) {
  if (lensType === 'prime35') return LensType.PRIME35;
  if (lensType === 'prime105') return LensType.PRIME105;
  if (lensType === 'movie') return LensType.MOVIEPRIME;
  return LensType.ZOOMLENS; // 'zoom' default (50-300mm zoom)
}

function __mcp_waveType(waveType) {
  if (waveType === 'triangle') return WaveType.TRIANGULAR;
  if (waveType === 'square') return WaveType.SQUARE;
  return WaveType.SINE;
}

/** The active layer's geometric center as a [UnitValue, UnitValue] point (for radial blur). */
function __mcp_layerCenterUnitPoint() {
  var b = app.activeDocument.activeLayer.bounds;
  var cx = (b[0].as('px') + b[2].as('px')) / 2;
  var cy = (b[1].as('px') + b[3].as('px')) / 2;
  return [new UnitValue(cx, 'px'), new UnitValue(cy, 'px')];
}

/**
 * Apply a filter by friendly name. \`p\` is a plain object of already-validated
 * numeric/string params. Returns the (post-rasterize) layer name.
 */
function __mcp_applyFilter(name, p) {
  var layer = __mcp_ensureRasterActiveLayer();
  switch (name) {
    // --- Distort ---
    case 'twirl': layer.applyTwirl(p.angle); break;
    case 'ripple': layer.applyRipple(p.amount, RippleSize[String(p.size).toUpperCase()] || RippleSize.MEDIUM); break;
    case 'pinch': layer.applyPinch(p.amount); break;
    case 'spherize': layer.applySpherize(p.amount, __mcp_spherizeMode(p.mode)); break;
    case 'polar_coordinates': layer.applyPolarCoordinates(__mcp_polarConversion(p.conversion)); break;
    case 'zigzag': layer.applyZigZag(p.amount, p.ridges, __mcp_zigZagType(p.style)); break;
    case 'wave':
      layer.applyWave(p.generators, p.minWavelength, p.maxWavelength, p.minAmplitude, p.maxAmplitude,
        100, 100, __mcp_waveType(p.waveType), UndefinedAreas.WRAPAROUND, 1);
      break;
    case 'ocean_ripple': layer.applyOceanRipple(p.size, p.magnitude); break;
    case 'glass':
      layer.applyGlassEffect(p.distortion, p.smoothness, 100, false, TextureType.FROSTED, undefined);
      break;
    case 'shear':
      layer.applyShear([[0, 0], [p.offset, 255]], UndefinedAreas.WRAPAROUND);
      break;

    // --- Stylize ---
    case 'glowing_edges': layer.applyGlowingEdges(p.edgeWidth, p.edgeBrightness, p.smoothness); break;
    case 'emboss': layer.applyEmboss(p.angle, p.height, p.amount); break;
    case 'diffuse_glow': layer.applyDiffuseGlow(p.graininess, p.glowAmount, p.clearAmount); break;
    case 'find_edges': layer.applyFindEdges(); break;
    case 'solarize': layer.applySolarize(); break;

    // --- Pixelate ---
    case 'crystallize': layer.applyCrystallize(p.cellSize); break;
    case 'mosaic': layer.applyMosaic(p.cellSize); break;
    case 'pointillize': layer.applyPointillize(p.cellSize); break;
    case 'facet': layer.applyFacet(); break;

    // --- Render ---
    case 'lens_flare':
      var __lfB = layer.bounds;
      var __lfX = __lfB[0].as('px') + (__lfB[2].as('px') - __lfB[0].as('px')) * (p.positionX / 100);
      var __lfY = __lfB[1].as('px') + (__lfB[3].as('px') - __lfB[1].as('px')) * (p.positionY / 100);
      layer.applyLensFlare(p.brightness, [[__lfX, 'px'], [__lfY, 'px']], __mcp_lensType(p.lensType));
      break;
    case 'difference_clouds': layer.applyDifferenceClouds(); break;
    case 'clouds': layer.applyClouds(); break;

    // --- Blur (variants not already tooled) ---
    case 'smart_blur': layer.applySmartBlur(p.radius, p.threshold, SmartBlurQuality.HIGH, SmartBlurMode.NORMAL); break;
    case 'radial_blur': layer.applyRadialBlur(p.amount, __mcp_radialBlurMethod(p.method), RadialBlurQuality.GOOD, __mcp_layerCenterUnitPoint()); break;
    case 'lens_blur':
      layer.applyLensBlur(DepthMapSource.NONE, 0, false, Geometry.HEXAGON, p.radius, 0, 0,
        p.brightness, p.threshold, 0, NoiseDistribution.UNIFORM, false);
      break;
    case 'surface_blur': __mcp_applySurfaceBlur(p.radius, p.threshold); break;
    case 'box_blur': __mcp_applyBoxBlur(p.radius); break;
    case 'shape_blur': __mcp_applyShapeBlur(p.radius); break;

    default:
      throw new Error('Unknown filter "' + name + '"');
  }
  return layer.name;
}
`;

/**
 * Extra transform helpers (skew / free-distort corners / perspective / warp / free transform).
 *
 * Each function drives the Action Manager \`transform\` or \`warp\` event on the ACTIVE
 * LAYER. Assumes the shared AM helpers (__mcp_s2t / __mcp_c2t) and
 * __mcp_ensureRasterActiveLayer from RECIPE_ACTION_HELPERS are already in scope
 * (always true — run only through executeRecipe()).
 *
 * Corner points are absolute document pixel coordinates in order
 * [topLeft, topRight, bottomRight, bottomLeft].
 */
export const MCP_TRANSFORM_EXTRA_HELPER = `
/** Read the active layer's bounds as {left,top,right,bottom,width,height} in px. */
function __mcp_layerBoundsPx() {
  var b = app.activeDocument.activeLayer.bounds;
  var left = b[0].as('px'), top = b[1].as('px'), right = b[2].as('px'), bottom = b[3].as('px');
  return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
}

/**
 * Free-distort by four absolute corner points. This is the ONE quad primitive that
 * skew / distort / perspective all route through — they differ only in how the four
 * destination corners are computed.
 *
 * Uses the transform event \`Trnf\` (charID) with two ActionLists:
 *   - 'rectangle'    = SOURCE quad (current layer bounds): 4 pixel doubles L, T, R, B.
 *   - 'quadrilateral'= DEST corners: 8 pixel doubles TLx,TLy, TRx,TRy, BRx,BRy, BLx,BLy
 *                      (alternating X,Y, clockwise from top-left).
 * List entries carry the unit (pixelsUnit) and have no per-entry key. Ruler units are
 * forced to pixels around the call because the quad math is unit-sensitive.
 */
function __mcp_transformCorners(tl, tr, br, bl) {
  if (app.activeDocument.activeLayer.isBackgroundLayer) {
    throw new Error('Cannot transform the background layer. Duplicate it or convert it to a normal layer first.');
  }
  var __savedUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  try {
    var bnds = __mcp_layerBoundsPx();
    var d = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(__mcp_c2t('Lyr '), __mcp_c2t('Ordn'), __mcp_c2t('Trgt'));
    d.putReference(__mcp_c2t('null'), ref);
    d.putEnumerated(__mcp_c2t('FTcs'), __mcp_c2t('QCSt'), __mcp_c2t('Qcsa'));

    // Source rectangle = current layer bounds, order left, top, right, bottom.
    var rect = new ActionList();
    rect.putUnitDouble(__mcp_c2t('#Pxl'), bnds.left);
    rect.putUnitDouble(__mcp_c2t('#Pxl'), bnds.top);
    rect.putUnitDouble(__mcp_c2t('#Pxl'), bnds.right);
    rect.putUnitDouble(__mcp_c2t('#Pxl'), bnds.bottom);
    d.putList(__mcp_s2t('rectangle'), rect);

    // Destination quadrilateral = 8 doubles, clockwise from top-left.
    var corners = [tl, tr, br, bl];
    var quad = new ActionList();
    for (var i = 0; i < 4; i++) {
      quad.putUnitDouble(__mcp_c2t('#Pxl'), corners[i].x);
      quad.putUnitDouble(__mcp_c2t('#Pxl'), corners[i].y);
    }
    d.putList(__mcp_s2t('quadrilateral'), quad);

    d.putEnumerated(__mcp_s2t('interpolation'), __mcp_s2t('interpolationType'), __mcp_s2t('bicubic'));
    executeAction(__mcp_c2t('Trnf'), d, DialogModes.NO);
  } finally {
    app.preferences.rulerUnits = __savedUnits;
  }
}

/**
 * Affine transform via the classic 'transform' event keys (width/height percent, angle,
 * single horizontal skew, offset). This is the scriptlistener-standard form and covers
 * scale + rotate + horizontal skew + move reliably. Vertical skew is NOT expressible here
 * (the event has a single 'skew' key) — callers needing 2D skew use __mcp_skew (corner quad).
 */
function __mcp_affineTransform(scaleX, scaleY, angle, skewH, offsetX, offsetY) {
  if (app.activeDocument.activeLayer.isBackgroundLayer) {
    throw new Error('Cannot transform the background layer. Duplicate it or convert it to a normal layer first.');
  }
  var d = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putEnumerated(__mcp_c2t('Lyr '), __mcp_c2t('Ordn'), __mcp_c2t('Trgt'));
  d.putReference(__mcp_c2t('null'), ref);
  d.putEnumerated(__mcp_c2t('FTcs'), __mcp_c2t('QCSt'), __mcp_c2t('Qcsa'));
  var offset = new ActionDescriptor();
  offset.putUnitDouble(__mcp_c2t('Hrzn'), __mcp_c2t('#Pxl'), offsetX);
  offset.putUnitDouble(__mcp_c2t('Vrtc'), __mcp_c2t('#Pxl'), offsetY);
  d.putObject(__mcp_c2t('Ofst'), __mcp_c2t('Ofst'), offset);
  d.putUnitDouble(__mcp_c2t('Wdth'), __mcp_c2t('#Prc'), scaleX);
  d.putUnitDouble(__mcp_c2t('Hght'), __mcp_c2t('#Prc'), scaleY);
  d.putUnitDouble(__mcp_c2t('Angl'), __mcp_c2t('#Ang'), angle);
  d.putUnitDouble(__mcp_c2t('Skew'), __mcp_c2t('#Ang'), skewH);
  d.putEnumerated(__mcp_s2t('interpolation'), __mcp_s2t('interpolationType'), __mcp_s2t('bicubic'));
  executeAction(__mcp_c2t('Trnf'), d, DialogModes.NO);
}

/**
 * Skew the active layer by horizontal/vertical angles (degrees). Routed through the
 * corner-quad primitive (research §1B) for both axes — this gives reliable, consistent
 * "which edge is anchored" semantics vs. the anchor-dependent numeric 'Skew' key.
 *
 * Skew maps a rectangle to a parallelogram: a horizontal skew shifts x proportional to
 * vertical position; a vertical skew shifts y proportional to horizontal position. The
 * top-left corner is the anchor.
 */
function __mcp_skew(hAngle, vAngle) {
  var bnds = __mcp_layerBoundsPx();
  var hRad = hAngle * Math.PI / 180;
  var vRad = vAngle * Math.PI / 180;
  var dx = bnds.height * Math.tan(hRad);
  var dy = bnds.width * Math.tan(vRad);
  var tl = { x: bnds.left,        y: bnds.top };
  var tr = { x: bnds.right,       y: bnds.top + dy };
  var br = { x: bnds.right + dx,  y: bnds.bottom + dy };
  var bl = { x: bnds.left + dx,   y: bnds.bottom };
  __mcp_transformCorners(tl, tr, br, bl);
}

/**
 * Perspective transform: symmetric squeeze by \`amount\` percent. axis 'horizontal' narrows
 * the TOP edge; axis 'vertical' narrows the RIGHT edge. amount>0 narrows (classic
 * perspective), amount<0 widens. Implemented via the corner quad.
 */
function __mcp_perspective(axis, amount) {
  var bnds = __mcp_layerBoundsPx();
  var tl = { x: bnds.left,  y: bnds.top };
  var tr = { x: bnds.right, y: bnds.top };
  var br = { x: bnds.right, y: bnds.bottom };
  var bl = { x: bnds.left,  y: bnds.bottom };
  if (axis === 'vertical') {
    var vInset = bnds.height * (amount / 100) / 2;
    // Narrow the right edge (top-right down, bottom-right up).
    tr.y = bnds.top + vInset;
    br.y = bnds.bottom - vInset;
  } else {
    var hInset = bnds.width * (amount / 100) / 2;
    // Narrow the top edge (top-left right, top-right left).
    tl.x = bnds.left + hInset;
    tr.x = bnds.right - hInset;
  }
  __mcp_transformCorners(tl, tr, br, bl);
}

/**
 * Warp preset style names → AM warpStyle enum stringIDs. These are stringID-only
 * (not in the 4-char dictionary): the 'warp' prefix + the style name PascalCased,
 * matching the UXP WarpStyle enum. Note 'Fisheye' is one word -> 'warpFisheye'.
 */
function __mcp_warpStyleEnum(style) {
  var map = {
    arc: 'warpArc', arc_lower: 'warpArcLower', arc_upper: 'warpArcUpper', arch: 'warpArch',
    bulge: 'warpBulge', shell_lower: 'warpShellLower', shell_upper: 'warpShellUpper',
    flag: 'warpFlag', wave: 'warpWave', fish: 'warpFish', rise: 'warpRise',
    fisheye: 'warpFisheye', inflate: 'warpInflate', squeeze: 'warpSqueeze', twist: 'warpTwist'
  };
  var v = map[style];
  if (!v) throw new Error('Unknown warp style "' + style + '"');
  return v;
}

/**
 * Warp the active layer with a preset style via the transform event \`Trnf\`, carrying a
 * 'warp' sub-descriptor (research §4). \`bend\` is the Bend slider percent (-100..100);
 * \`hDistort\`/\`vDistort\` are the horizontal/vertical distortion percents (-100..100).
 * These are stored as PERCENT doubles (NOT 0-1 fractions). Orientation toggles the warp's
 * principal axis. The layer bounds are supplied as the warp bounds, with spline order 4/4.
 */
function __mcp_warp(style, bend, hDistort, vDistort, orientation) {
  if (app.activeDocument.activeLayer.isBackgroundLayer) {
    throw new Error('Cannot transform the background layer. Duplicate it or convert it to a normal layer first.');
  }
  var __savedUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  try {
    var bnds = __mcp_layerBoundsPx();
    var d = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(__mcp_c2t('Lyr '), __mcp_c2t('Ordn'), __mcp_c2t('Trgt'));
    d.putReference(__mcp_c2t('null'), ref);
    d.putEnumerated(__mcp_c2t('FTcs'), __mcp_c2t('QCSt'), __mcp_c2t('Qcsa'));

    var w = new ActionDescriptor();
    // warpStyle: class AND enum are both stringID('warpStyle'); value is a warp* stringID.
    w.putEnumerated(__mcp_s2t('warpStyle'), __mcp_s2t('warpStyle'), __mcp_s2t(__mcp_warpStyleEnum(style)));
    w.putDouble(__mcp_s2t('warpValue'), bend);               // Bend slider (percent, -100..100)
    w.putDouble(__mcp_s2t('warpPerspective'), hDistort);     // Horizontal distortion (percent)
    w.putDouble(__mcp_s2t('warpPerspectiveOther'), vDistort);// Vertical distortion (percent)
    w.putEnumerated(__mcp_s2t('warpRotate'), __mcp_c2t('Ornt'),
      (orientation === 'vertical') ? __mcp_c2t('Vrtc') : __mcp_c2t('Hrzn'));

    // bounds = the transform bounds the warp is applied over (object class 'Rctn').
    var boundsDesc = new ActionDescriptor();
    boundsDesc.putUnitDouble(__mcp_c2t('Top '), __mcp_c2t('#Pxl'), bnds.top);
    boundsDesc.putUnitDouble(__mcp_c2t('Left'), __mcp_c2t('#Pxl'), bnds.left);
    boundsDesc.putUnitDouble(__mcp_c2t('Btom'), __mcp_c2t('#Pxl'), bnds.bottom);
    boundsDesc.putUnitDouble(__mcp_c2t('Rght'), __mcp_c2t('#Pxl'), bnds.right);
    w.putObject(__mcp_s2t('bounds'), __mcp_c2t('Rctn'), boundsDesc);

    w.putInteger(__mcp_s2t('uOrder'), 4);
    w.putInteger(__mcp_s2t('vOrder'), 4);

    d.putObject(__mcp_s2t('warp'), __mcp_s2t('warp'), w);
    executeAction(__mcp_c2t('Trnf'), d, DialogModes.NO);
  } finally {
    app.preferences.rulerUnits = __savedUnits;
  }
}

/**
 * Free transform: scale (percent), rotate (degrees), skew (degrees), anchored at center,
 * in one call. Scale and rotation use the reliable DOM methods (layer.resize / layer.rotate,
 * the same primitives scale_layer / rotate_layer use); skew has no DOM method and falls back
 * to the affine 'transform' event. Background layers cannot be transformed.
 */
function __mcp_freeTransform(scaleX, scaleY, angle, skewH, skewV) {
  var layer = app.activeDocument.activeLayer;
  if (layer.isBackgroundLayer) {
    throw new Error('Cannot transform the background layer. Duplicate it or convert it to a normal layer first.');
  }
  if (scaleX !== 100 || scaleY !== 100) {
    layer.resize(scaleX, scaleY, AnchorPosition.MIDDLECENTER);
  }
  if (angle !== 0) {
    layer.rotate(angle, AnchorPosition.MIDDLECENTER);
  }
  if (skewH !== 0) {
    __mcp_affineTransform(100, 100, 0, skewH, 0, 0);
  }
  if (skewV !== 0) {
    __mcp_skew(0, skewV);
  }
}
`;

export type CurvesPreset = 'auto_tone' | 'neutral';

export type GradientMaskDirection =
  | 'top_to_bottom'
  | 'bottom_to_top'
  | 'left_to_right'
  | 'right_to_left';

/**
 * Common ExtendScript snippets
 */
export const ExtendScriptSnippets = {
  /**
   * Get Photoshop application info
   */
  getAppInfo: () => `
    return {
      name: app.name,
      version: app.version,
      build: app.build
    };
  `,

  /**
   * Create a new document
   */
  newDocument: (width: number, height: number, resolution = 72, colorMode = 'NewDocumentMode.RGB') => `
    var doc = app.documents.add(
      UnitValue(${width}, 'px'),
      UnitValue(${height}, 'px'),
      ${resolution},
      'New Document',
      ${colorMode}
    );
    return { id: doc.id, name: doc.name };
  `,

  /**
   * Get active document info
   */
  getDocumentInfo: () => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    
    var context = getContextInfo();
    return context;
  `,

  /**
   * Create a text layer
   */
  createTextLayer: (
    text: string,
    x = 100,
    y = 100,
    fontSize = 24,
    fontName?: string,
    center?: 'horizontal' | 'vertical' | 'both',
    color?: { red: number; green: number; blue: number }
  ) => `
    ${getContextInfo}
    ${resolveFontPostScriptName}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var textLayer = doc.artLayers.add();
    textLayer.kind = LayerKind.TEXT;
    textLayer.textItem.contents = "${jsString(text)}";
    textLayer.textItem.position = [${x}, ${y}];
    textLayer.textItem.size = ${fontSize};
    ${fontName ? `
    var __psFont = resolveFontPostScriptName("${jsString(fontName)}");
    if (!__psFont) {
      throw new Error('font_not_found: ${jsString(fontName)}');
    }
    textLayer.textItem.font = __psFont;
    ` : ''}
    ${color ? `
    var __textColor = new SolidColor();
    __textColor.rgb.red = ${color.red};
    __textColor.rgb.green = ${color.green};
    __textColor.rgb.blue = ${color.blue};
    textLayer.textItem.color = __textColor;
    ` : ''}
    ${center ? `
    // Center the text layer on the canvas by translating its bounding box.
    var __b = textLayer.bounds;
    var __layerCx = (__b[0].as('px') + __b[2].as('px')) / 2;
    var __layerCy = (__b[1].as('px') + __b[3].as('px')) / 2;
    var __dx = ${center === 'horizontal' || center === 'both' ? '(doc.width.as("px") / 2) - __layerCx' : '0'};
    var __dy = ${center === 'vertical' || center === 'both' ? '(doc.height.as("px") / 2) - __layerCy' : '0'};
    if (__dx !== 0 || __dy !== 0) { textLayer.translate(__dx, __dy); }
    ` : ''}

    var __finalBounds = textLayer.bounds;
    var result = {
      created: true,
      layerName: textLayer.name,
      text: "${jsString(text)}",
      position: { x: ${x}, y: ${y} },
      centered: ${center ? `"${center}"` : 'false'},
      bounds: {
        left: __finalBounds[0].as('px'),
        top: __finalBounds[1].as('px'),
        right: __finalBounds[2].as('px'),
        bottom: __finalBounds[3].as('px')
      },
      fontSize: ${fontSize},
      ${color ? `color: 'RGB(${color.red}, ${color.green}, ${color.blue})',` : ''}
      ${fontName ? `font: textLayer.textItem.font,` : ''}
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Place an image file as a layer
   */
  placeImage: (filePath: string, x = 0, y = 0) => `
    ${helperFunctions}
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    
    var imageFile = new File("${jsString(filePath)}");
    if (!imageFile.exists) {
      throw new Error('Image file not found: ${jsString(filePath)}');
    }
    
    // Place image using ActionDescriptor
    var desc = new ActionDescriptor();
    desc.putPath(cTID('null'), imageFile);
    desc.putEnumerated(cTID('FTcs'), cTID('QCSt'), cTID('Qcsa'));
    
    var offsetDesc = new ActionDescriptor();
    offsetDesc.putUnitDouble(cTID('Hrzn'), cTID('#Pxl'), ${x});
    offsetDesc.putUnitDouble(cTID('Vrtc'), cTID('#Pxl'), ${y});
    desc.putObject(cTID('Ofst'), cTID('Ofst'), offsetDesc);
    
    executeAction(cTID('Plc '), desc, DialogModes.NO);
    
    var result = {
      placed: true,
      filePath: "${jsString(filePath)}",
      position: { x: ${x}, y: ${y} },
      context: getContextInfo()
    };
    try {
      var layer = app.activeDocument.activeLayer;
      result.layerName = layer.name;
      var bounds = layer.bounds;
      result.layerBounds = {
        width: bounds[2].as('px') - bounds[0].as('px'),
        height: bounds[3].as('px') - bounds[1].as('px')
      };
    } catch (e) {
      // Place succeeded; layer metadata is best-effort
    }
    return result;
  `,

  /**
   * Open an image file as a new document
   */
  openImage: (filePath: string) => `
    var imageFile = new File("${jsString(filePath)}");
    if (!imageFile.exists) {
      throw new Error('Image file not found: ${jsString(filePath)}');
    }
    
    var doc = app.open(imageFile);
    return {
      id: doc.id,
      name: doc.name,
      width: doc.width.as('px'),
      height: doc.height.as('px')
    };
  `,

  /**
   * Save document as PSD
   */
  saveAsPSD: (path: string) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var saveFile = new File("${path.replace(/\\/g, '\\\\')}");
    var psdOptions = new PhotoshopSaveOptions();
    psdOptions.embedColorProfile = true;
    doc.saveAs(saveFile, psdOptions, true);
    return { path: saveFile.fsName };
  `,

  /**
   * Save document as JPEG
   */
  saveAsJPEG: (path: string, quality = 8) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var saveFile = new File("${path.replace(/\\/g, '\\\\')}");
    var jpegOptions = new JPEGSaveOptions();
    jpegOptions.quality = ${quality};
    jpegOptions.embedColorProfile = true;
    doc.saveAs(saveFile, jpegOptions, true);
    return { path: saveFile.fsName };
  `,

  /**
   * Save document as PNG
   */
  saveAsPNG: (path: string) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var saveFile = new File("${path.replace(/\\/g, '\\\\')}");
    var pngOptions = new PNGSaveOptions();
    pngOptions.compression = 9;
    doc.saveAs(saveFile, pngOptions, true);
    return { path: saveFile.fsName };
  `,

  /**
   * Close active document
   */
  closeDocument: (save = false) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    doc.close(${save ? 'SaveOptions.SAVECHANGES' : 'SaveOptions.DONOTSAVECHANGES'});
    return { closed: true };
  `,

  /**
   * Create a new layer
   */
  newLayer: (name?: string) => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.artLayers.add();
    ${name ? `layer.name = "${jsString(name)}";` : ''}
    
    var result = { 
      created: true,
      layerName: layer.name,
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Delete active layer
   */
  deleteLayer: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    if (doc.activeLayer) {
      doc.activeLayer.remove();
      return { deleted: true };
    }
    throw new Error('No active layer');
  `,

  /**
   * Fill the active layer with a solid RGB color.
   *
   * ArtLayer has no fillPath() method (that exists on PathItem only).
   * The correct approach is Selection.fill(): preserve any existing
   * selection, otherwise select the whole canvas, fill, then deselect.
   * Background / fully-locked layers cannot be filled, so fail clearly.
   */
  fillLayer: (red: number, green: number, blue: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;

    if (layer.allLocked) {
      throw new Error('Cannot fill a fully locked layer: ' + layer.name);
    }
    if (layer.kind === LayerKind.TEXT) {
      throw new Error('Cannot fill a text layer. Rasterize it first.');
    }

    var color = new SolidColor();
    color.rgb.red = ${red};
    color.rgb.green = ${green};
    color.rgb.blue = ${blue};

    var hadSelection = false;
    try {
      hadSelection = doc.selection.bounds != null;
    } catch (e) {
      hadSelection = false;
    }

    if (!hadSelection) {
      doc.selection.selectAll();
    }
    doc.selection.fill(color);
    if (!hadSelection) {
      doc.selection.deselect();
    }

    return {
      filled: true,
      layerName: layer.name,
      color: { red: ${red}, green: ${green}, blue: ${blue} }
    };
  `,

  /**
   * Resize image
   */
  resizeImage: (width: number, height: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    doc.resizeImage(
      UnitValue(${width}, 'px'),
      UnitValue(${height}, 'px'),
      null,
      ResampleMethod.BICUBIC
    );
    return { 
      width: doc.width.as('px'), 
      height: doc.height.as('px') 
    };
  `,

  /**
   * Get all layer names
   */
  getLayerNames: () => `
    ${getContextInfo}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    // §6.6 — the DOM property layer.hasLayerMask is unreliable in PS 2026 (returns
    // undefined even for masks created via Action Manager). Probe the layer's
    // user-mask channel by its stable id instead: an AM getd on a layer reference
    // keyed by id exposes the 'UsrM' property only when a user mask exists.
    function __mcp_layerHasMaskById(layerId) {
      try {
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID('Prpr'), charIDToTypeID('UsrM'));
        ref.putIdentifier(charIDToTypeID('Lyr '), layerId);
        var args = new ActionDescriptor();
        args.putReference(charIDToTypeID('null'), ref);
        var resultDesc = executeAction(charIDToTypeID('getd'), args, DialogModes.NO);
        return resultDesc.hasKey(charIDToTypeID('UsrM'));
      } catch (e) {
        return false;
      }
    }
    var doc = app.activeDocument;
    var layers = [];
    function collectLayers(container) {
      for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        try {
          var layerHasMask = false;
          try { layerHasMask = __mcp_layerHasMaskById(layer.id); } catch (eMask) { layerHasMask = false; }
          layers.push({
            name: layer.name,
            kind: (layer.typename === 'LayerSet' ? 'LayerKind.GROUP' : String(layer.kind)),
            visible: layer.visible,
            opacity: layer.opacity,
            blendMode: String(layer.blendMode),
            hasMask: layerHasMask
          });
        } catch (e) {
          var layerName = 'layer_' + layers.length;
          try { layerName = layer.name; } catch (e2) {}
          layers.push({ name: layerName, error: e.message || String(e) });
        }
        if (layer.typename === 'LayerSet') {
          collectLayers(layer);
        }
      }
    }
    collectLayers(doc);
    
    var result = {
      layerCount: layers.length,
      layers: layers,
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Select layer by name (recursive search including layer groups).
   * §6.8: when layerId is supplied it targets by native id instead of by name,
   * so a chain can re-bind to the exact layer a prior step returned. Returns the
   * resolved layerId (the target-identity contract: layer-targeting commands
   * accept an optional layerId and report the affected id).
   */
  selectLayerByName: (name: string, layerId?: number) => `
    ${getContextInfo}
    ${MCP_LAYER_IDENTITY_HELPERS}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var target = null;
    ${
      typeof layerId === 'number'
        ? `target = __mcp_selectLayerById(${layerId});`
        : `var targetName = "${jsString(name)}";
    function findLayer(container, name) {
      for (var i = 0; i < container.layers.length; i++) {
        var l = container.layers[i];
        if (l.name === name) return l;
      }
      for (var j = 0; j < container.layerSets.length; j++) {
        var nested = findLayer(container.layerSets[j], name);
        if (nested) return nested;
      }
      return null;
    }
    target = findLayer(doc, targetName);
    if (!target) {
      throw new Error('Layer not found: ' + targetName);
    }
    doc.activeLayer = target;`
    }
    var result = {
      selected: true,
      layerName: target.name,
      layerId: __mcp_layerIdSafe(target),
      kind: (target.typename === 'LayerSet' ? 'LayerKind.GROUP' : String(target.kind)),
      context: getContextInfo()
    };
    try {
      var b = target.bounds;
      result.bounds = {
        left: b[0].as('px'),
        top: b[1].as('px'),
        right: b[2].as('px'),
        bottom: b[3].as('px'),
        width: b[2].as('px') - b[0].as('px'),
        height: b[3].as('px') - b[1].as('px')
      };
    } catch (e) {}
    return result;
  `,

  /**
   * Scale active layer to fit document (maintain aspect ratio)
   */
  fitLayerToDocument: (fillDocument = false) => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    if (layer.isBackgroundLayer) {
      throw new Error('Cannot transform background layer');
    }
    
    // Get canvas dimensions
    var canvasWidth = doc.width.as('px');
    var canvasHeight = doc.height.as('px');
    
    // Get layer bounds
    var bounds = layer.bounds;
    var layerWidth = bounds[2].as('px') - bounds[0].as('px');
    var layerHeight = bounds[3].as('px') - bounds[1].as('px');
    
    // Calculate scale ratios
    var widthRatio = canvasWidth / layerWidth;
    var heightRatio = canvasHeight / layerHeight;
    
    // Choose scale factor based on fill or fit mode
    var scaleFactor;
    if (${fillDocument}) {
      // Fill: scale to cover entire canvas (may crop)
      scaleFactor = Math.max(widthRatio, heightRatio);
    } else {
      // Fit: scale to fit within canvas (may have margins)
      scaleFactor = Math.min(widthRatio, heightRatio);
    }
    
    // Apply scale
    var scalePercent = scaleFactor * 100;
    layer.resize(scalePercent, scalePercent, AnchorPosition.MIDDLECENTER);
    
    // Center the layer
    layer.translate(
      canvasWidth / 2 - (bounds[0].as('px') + layerWidth / 2),
      canvasHeight / 2 - (bounds[1].as('px') + layerHeight / 2)
    );
    
    var result = {
      fitted: true,
      mode: ${fillDocument} ? 'fill' : 'fit',
      originalSize: { width: layerWidth, height: layerHeight },
      newSize: { 
        width: layerWidth * scaleFactor, 
        height: layerHeight * scaleFactor 
      },
      scaleFactor: scaleFactor,
      scalePercent: scalePercent,
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Scale active layer by percentage
   */
  scaleLayer: (scalePercent: number, centerAnchor = true) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    if (layer.isBackgroundLayer) {
      throw new Error('Cannot transform background layer');
    }
    
    var anchor = ${centerAnchor ? 'AnchorPosition.MIDDLECENTER' : 'AnchorPosition.TOPLEFT'};
    layer.resize(${scalePercent}, ${scalePercent}, anchor);
    
    return { 
      scaled: true,
      percent: ${scalePercent}
    };
  `,

  /**
   * Move/translate active layer
   */
  moveLayer: (deltaX: number, deltaY: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    if (layer.isBackgroundLayer) {
      throw new Error('Cannot move background layer');
    }
    
    layer.translate(${deltaX}, ${deltaY});
    
    return { 
      moved: true,
      deltaX: ${deltaX},
      deltaY: ${deltaY}
    };
  `,

  /**
   * Rotate active layer
   */
  rotateLayer: (degrees: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    if (layer.isBackgroundLayer) {
      throw new Error('Cannot rotate background layer');
    }
    
    layer.rotate(${degrees}, AnchorPosition.MIDDLECENTER);
    
    return { 
      rotated: true,
      degrees: ${degrees}
    };
  `,

  /**
   * Set layer opacity
   */
  setLayerOpacity: (opacity: number, layerId?: number) => `
    ${getContextInfo}
    ${MCP_LAYER_IDENTITY_HELPERS}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = ${typeof layerId === 'number' ? `__mcp_selectLayerById(${layerId})` : 'doc.activeLayer'};

    layer.opacity = ${opacity};

    var result = {
      updated: true,
      property: 'opacity',
      value: layer.opacity,
      layerName: layer.name,
      layerId: __mcp_layerIdSafe(layer),
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Set layer blend mode. §6.8: optional layerId targets a specific layer and the
   * result carries the affected layerId.
   */
  setLayerBlendMode: (blendMode: string, layerId?: number) => `
    ${getContextInfo}
    ${MCP_LAYER_IDENTITY_HELPERS}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = ${typeof layerId === 'number' ? `__mcp_selectLayerById(${layerId})` : 'doc.activeLayer'};

    layer.blendMode = BlendMode.${blendMode};

    var result = {
      updated: true,
      property: 'blendMode',
      value: String(layer.blendMode),
      layerName: layer.name,
      layerId: __mcp_layerIdSafe(layer),
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Set layer visibility
   */
  setLayerVisibility: (visible: boolean) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    layer.visible = ${visible};
    
    return { 
      visible: layer.visible,
      name: layer.name
    };
  `,

  /**
   * Lock/unlock layer
   */
  setLayerLocked: (locked: boolean) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    layer.allLocked = ${locked};
    
    return { 
      locked: layer.allLocked,
      name: layer.name
    };
  `,

  /**
   * Rename active layer
   */
  renameLayer: (newName: string) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    var oldName = layer.name;
    layer.name = "${jsString(newName)}";
    
    return { 
      oldName: oldName,
      newName: layer.name
    };
  `,

  /**
   * Duplicate a layer (the active layer by default, or the layer with `layerId`).
   * §6.8: returns the NEW layer's id as `layerId` — the affected-id the contract
   * requires so a follow-up (mask/select) binds to the copy, not whatever is
   * active. DOM layer.duplicate() does NOT reliably activate the copy (§6.1), so
   * the id is read straight off the returned duplicate rather than from
   * activeLayer.
   */
  duplicateLayer: (newName?: string, layerId?: number) => `
    ${MCP_LAYER_IDENTITY_HELPERS}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = ${typeof layerId === 'number' ? `__mcp_selectLayerById(${layerId})` : 'doc.activeLayer'};

    var duplicated = layer.duplicate();
    ${newName ? `duplicated.name = "${jsString(newName)}";` : ''}

    return {
      originalName: layer.name,
      originalLayerId: __mcp_layerIdSafe(layer),
      newName: duplicated.name,
      layerId: __mcp_layerIdSafe(duplicated)
    };
  `,

  /**
   * Merge visible layers
   */
  mergeVisibleLayers: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    doc.mergeVisibleLayers();
    
    return { 
      merged: true
    };
  `,

  /**
   * Flatten image (merge all layers)
   */
  flattenImage: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    doc.flatten();
    
    return { 
      flattened: true
    };
  `,

  /**
   * Apply Gaussian Blur filter
   */
  applyGaussianBlur: (radius: number) => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    var wasRasterized = false;
    
    // Auto-rasterize if needed
    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
      wasRasterized = true;
    }
    
    if (layer.kind !== LayerKind.NORMAL) {
      throw new Error('Can only apply filters to normal (raster) layers. Layer kind: ' + layer.kind);
    }
    
    layer.applyGaussianBlur(${radius});
    
    var result = { 
      applied: true,
      filter: 'Gaussian Blur',
      radius: ${radius},
      wasRasterized: wasRasterized,
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Apply Unsharp Mask (sharpen)
   */
  applyUnsharpMask: (amount: number, radius: number, threshold: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    // Auto-rasterize if needed
    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }
    
    if (layer.kind !== LayerKind.NORMAL) {
      throw new Error('Can only apply filters to normal (raster) layers');
    }
    
    layer.applyUnSharpMask(${amount}, ${radius}, ${threshold});
    
    return { 
      filter: 'Unsharp Mask',
      amount: ${amount},
      radius: ${radius},
      threshold: ${threshold}
    };
  `,

  /**
   * Apply Add Noise filter
   */
  applyAddNoise: (amount: number, distribution: string, monochromatic: boolean) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    // Auto-rasterize if needed
    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }
    
    if (layer.kind !== LayerKind.NORMAL) {
      throw new Error('Can only apply filters to normal (raster) layers');
    }
    
    var distEnum = NoiseDistribution.${distribution};
    layer.applyAddNoise(${amount}, distEnum, ${monochromatic});
    
    return { 
      filter: 'Add Noise',
      amount: ${amount},
      distribution: '${distribution}',
      monochromatic: ${monochromatic}
    };
  `,

  /**
   * Apply Motion Blur filter
   */
  applyMotionBlur: (angle: number, radius: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    // Auto-rasterize if needed
    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }
    
    if (layer.kind !== LayerKind.NORMAL) {
      throw new Error('Can only apply filters to normal (raster) layers');
    }
    
    layer.applyMotionBlur(${angle}, ${radius});
    
    return { 
      filter: 'Motion Blur',
      angle: ${angle},
      radius: ${radius}
    };
  `,

  /**
   * Adjust brightness and contrast
   */
  adjustBrightnessContrast: (brightness: number, contrast: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    // Auto-rasterize if needed
    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }
    
    layer.adjustBrightnessContrast(${brightness}, ${contrast});
    
    return { 
      adjustment: 'Brightness/Contrast',
      brightness: ${brightness},
      contrast: ${contrast}
    };
  `,

  /**
   * Adjust hue, saturation and lightness on the active layer.
   *
   * ArtLayer has no DOM method for Hue/Saturation - adjustColorBalance()
   * is for Color Balance (cyan/red, magenta/green, yellow/blue) and would
   * throw here. The correct path is the "HStr" Action Descriptor which
   * matches the Image > Adjustments > Hue/Saturation menu command.
   */
  adjustHueSaturation: (hue: number, saturation: number, lightness: number) => `
    ${helperFunctions}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;

    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }

    if (layer.blendMode !== BlendMode.NORMAL) {
      layer.blendMode = BlendMode.NORMAL;
    }

    if (layer.kind === LayerKind.NORMAL) {
      try { layer.rasterize(RasterizeType.ENTIRELAYER); } catch (eRaster) {}
    }

    function __runHueSatAction(hueVal, satVal, lightVal) {
      var desc = new ActionDescriptor();
      desc.putEnumerated(sTID('presetKind'), sTID('presetKindType'), sTID('presetKindCustom'));
      desc.putBoolean(cTID('Clrz'), false);
      var adjustments = new ActionList();
      var adjustment = new ActionDescriptor();
      adjustment.putEnumerated(cTID('Chnl'), cTID('Chnl'), cTID('Cmps'));
      adjustment.putInteger(cTID('H   '), hueVal);
      adjustment.putInteger(cTID('Strt'), satVal);
      adjustment.putInteger(cTID('Lght'), lightVal);
      adjustments.putObject(cTID('Hst2'), adjustment);
      desc.putList(cTID('Adjs'), adjustments);
      executeAction(cTID('HStr'), desc, DialogModes.NO);
    }

    try {
      __runHueSatAction(${hue}, ${saturation}, ${lightness});
    } catch (eHst2) {
      var legacy = new ActionDescriptor();
      legacy.putEnumerated(sTID('presetKind'), sTID('presetKindType'), sTID('presetKindCustom'));
      legacy.putBoolean(cTID('Clrz'), false);
      var legacyAdj = new ActionList();
      var legacyItem = new ActionDescriptor();
      legacyItem.putInteger(cTID('H   '), ${hue});
      legacyItem.putInteger(cTID('Strt'), ${saturation});
      legacyItem.putInteger(cTID('Lght'), ${lightness});
      legacyAdj.putObject(cTID('Hsrt'), legacyItem);
      legacy.putList(cTID('Adjs'), legacyAdj);
      executeAction(cTID('HStr'), legacy, DialogModes.NO);
    }

    return {
      adjustment: 'Hue/Saturation',
      hue: ${hue},
      saturation: ${saturation},
      lightness: ${lightness}
    };
  `,

  /**
   * Auto levels adjustment
   */
  autoLevels: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    // Auto-rasterize if needed
    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }
    
    layer.autoLevels();
    
    return { 
      adjustment: 'Auto Levels'
    };
  `,

  /**
   * Auto contrast adjustment
   */
  autoContrast: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    // Auto-rasterize if needed
    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }
    
    layer.autoContrast();
    
    return { 
      adjustment: 'Auto Contrast'
    };
  `,

  /**
   * Create a Curves adjustment layer (auto-tone S-curve or neutral identity curve).
   */
  adjustCurves: (preset: CurvesPreset = 'auto_tone') => `
    ${helperFunctions}
    ${mcpActionHelperAliases}
    ${MCP_CURVES_ADJUSTMENT_HELPER}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }

    app.displayDialogs = DialogModes.NO;
    var layer = __mcp_makeCurvesAdjustmentLayer('${preset}');

    return {
      created: true,
      layer_name: layer.name,
      preset: '${preset}'
    };
  `,

  /**
   * Desaturate (convert to grayscale without changing color mode)
   */
  desaturate: () => `
    ${helperFunctions}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;

    if (layer.blendMode !== BlendMode.NORMAL) {
      layer.blendMode = BlendMode.NORMAL;
    }

    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }

    if (layer.kind === LayerKind.NORMAL) {
      try { layer.rasterize(RasterizeType.ENTIRELAYER); } catch (eRaster) {}
    }

    try {
      layer.desaturate();
    } catch (eDom) {
      try {
        executeAction(sTID('desaturate'), undefined, DialogModes.NO);
      } catch (eAction) {
        var desc = new ActionDescriptor();
        desc.putEnumerated(sTID('presetKind'), sTID('presetKindType'), sTID('presetKindCustom'));
        desc.putBoolean(cTID('Clrz'), false);
        var adjustments = new ActionList();
        var adjustment = new ActionDescriptor();
        adjustment.putEnumerated(cTID('Chnl'), cTID('Chnl'), cTID('Cmps'));
        adjustment.putInteger(cTID('H   '), 0);
        adjustment.putInteger(cTID('Strt'), -100);
        adjustment.putInteger(cTID('Lght'), 0);
        adjustments.putObject(cTID('Hst2'), adjustment);
        desc.putList(cTID('Adjs'), adjustments);
        executeAction(cTID('HStr'), desc, DialogModes.NO);
      }
    }

    return {
      adjustment: 'Desaturate'
    };
  `,

  /**
   * Invert colors
   */
  invert: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    // Auto-rasterize if needed
    if (layer.kind === LayerKind.TEXT || layer.kind === LayerKind.SMARTOBJECT) {
      layer.rasterize(RasterizeType.ENTIRELAYER);
    }
    
    layer.invert();
    
    return { 
      adjustment: 'Invert'
    };
  `,

  /**
   * Crop document
   */
  cropDocument: (left: number, top: number, right: number, bottom: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    
    var bounds = [${left}, ${top}, ${right}, ${bottom}];
    doc.crop(bounds);
    
    return { 
      cropped: true,
      newWidth: doc.width.as('px'),
      newHeight: doc.height.as('px')
    };
  `,

  /**
   * Set text layer font
   */
  setTextFont: (fontName: string, fontSize?: number) => `
    ${resolveFontPostScriptName}
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    
    var __psFont = resolveFontPostScriptName("${jsString(fontName)}");
    if (!__psFont) {
      throw new Error('font_not_found: ${jsString(fontName)}');
    }
    layer.textItem.font = __psFont;
    ${fontSize ? `layer.textItem.size = ${fontSize};` : ''}
    
    return { 
      font: layer.textItem.font,
      size: layer.textItem.size
    };
  `,

  /**
   * List installed fonts (PostScript names required for TextItem.font).
   */
  listFonts: (query?: string, limit = 200) => `
    var query = ${query !== undefined ? `"${jsString(query)}"` : 'null'};
    var limit = ${limit};
    var fonts = [];
    var total = app.fonts.length;
    var truncated = false;
    for (var i = 0; i < total; i++) {
      var f = app.fonts[i];
      try {
        var entry = {
          name: f.name,
          postScriptName: f.postScriptName,
          family: f.family,
          style: f.style
        };
        if (query) {
          var q = query.toLowerCase();
          if (
            entry.name.toLowerCase().indexOf(q) < 0 &&
            entry.postScriptName.toLowerCase().indexOf(q) < 0 &&
            entry.family.toLowerCase().indexOf(q) < 0
          ) {
            continue;
          }
        }
        fonts.push(entry);
        if (fonts.length >= limit) {
          truncated = i < total - 1;
          break;
        }
      } catch (e) {}
    }
    return {
      fonts: fonts,
      total: total,
      truncated: truncated
    };
  `,

  /**
   * Set text color
   */
  setTextColor: (red: number, green: number, blue: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    
    var color = new SolidColor();
    color.rgb.red = ${red};
    color.rgb.green = ${green};
    color.rgb.blue = ${blue};
    layer.textItem.color = color;
    
    return { 
      color: 'RGB(' + ${red} + ', ' + ${green} + ', ' + ${blue} + ')'
    };
  `,

  /**
   * Set text alignment
   */
  setTextAlignment: (alignment: string) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    
    layer.textItem.justification = Justification.${alignment};
    
    return { 
      alignment: '${alignment}'
    };
  `,

  /**
   * Update text content
   */
  updateTextContent: (newText: string) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    
    layer.textItem.contents = "${jsString(newText)}";

    return {
      text: layer.textItem.contents
    };
  `,

  /**
   * Set character tracking (letter-spacing) on the active text layer.
   * Photoshop tracking is in 1/1000 em; range -1000..10000.
   */
  setTextTracking: (tracking: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    layer.textItem.tracking = ${tracking};
    return {
      tracking: layer.textItem.tracking
    };
  `,

  /**
   * Set leading (line spacing) in points on the active text layer, or turn on auto-leading.
   */
  setTextLeading: (leadingPoints: number | undefined, auto: boolean) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    ${
      auto
        ? `layer.textItem.useAutoLeading = true;`
        : `layer.textItem.useAutoLeading = false;
    layer.textItem.leading = ${leadingPoints};`
    }
    return {
      autoLeading: layer.textItem.useAutoLeading,
      leading: (layer.textItem.useAutoLeading ? null : layer.textItem.leading)
    };
  `,

  /**
   * Set kerning mode (metrics / optical / manual) on the active text layer via
   * TextItem.autoKerning (AutoKernType). "manual" turns auto-kerning off so per-pair
   * manual kerning applies.
   */
  setTextKerning: (mode: 'metrics' | 'optical' | 'manual') => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    layer.textItem.autoKerning = AutoKernType.${
      mode === 'metrics' ? 'METRICS' : mode === 'optical' ? 'OPTICAL' : 'MANUAL'
    };
    return {
      kerning: '${mode}',
      autoKerning: String(layer.textItem.autoKerning)
    };
  `,

  /**
   * Set letter case (all caps / small caps / normal) and toggle faux bold / faux italic
   * on the active text layer. Any argument left undefined is not touched.
   */
  setTextCase: (
    caseMode: 'allCaps' | 'smallCaps' | 'normal' | undefined,
    fauxBold: boolean | undefined,
    fauxItalic: boolean | undefined
  ) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    ${
      caseMode !== undefined
        ? `layer.textItem.capitalization = TextCase.${
            caseMode === 'allCaps' ? 'ALLCAPS' : caseMode === 'smallCaps' ? 'SMALLCAPS' : 'NORMAL'
          };`
        : ''
    }
    ${fauxBold !== undefined ? `layer.textItem.fauxBold = ${fauxBold};` : ''}
    ${fauxItalic !== undefined ? `layer.textItem.fauxItalic = ${fauxItalic};` : ''}
    return {
      capitalization: String(layer.textItem.capitalization),
      fauxBold: layer.textItem.fauxBold,
      fauxItalic: layer.textItem.fauxItalic
    };
  `,

  /**
   * Warp the active text layer (TextItem.warpStyle + bend + distortions). style 'none'
   * removes the warp. bend / horizontalDistortion / verticalDistortion are -100..100
   * percentages passed straight through to the DOM (which also uses -100..100).
   */
  warpText: (
    style: string,
    bend: number,
    horizontalDistortion: number,
    verticalDistortion: number
  ) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;
    if (layer.kind !== LayerKind.TEXT) {
      throw new Error('Active layer is not a text layer');
    }
    layer.textItem.warpStyle = WarpStyle.${style};
    ${
      style === 'NONE'
        ? ''
        : `layer.textItem.warpBend = ${bend};
    layer.textItem.warpHorizontalDistortion = ${horizontalDistortion};
    layer.textItem.warpVerticalDistortion = ${verticalDistortion};`
    }
    return {
      warpStyle: String(layer.textItem.warpStyle),
      warpBend: layer.textItem.warpBend,
      warpHorizontalDistortion: layer.textItem.warpHorizontalDistortion,
      warpVerticalDistortion: layer.textItem.warpVerticalDistortion
    };
  `,

  /**
   * Create rectangular selection
   */
  selectRectangle: (left: number, top: number, right: number, bottom: number) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    
    var bounds = [[${left}, ${top}], [${right}, ${top}], [${right}, ${bottom}], [${left}, ${bottom}]];
    doc.selection.select(bounds);
    
    return { 
      selection: 'rectangle',
      bounds: [${left}, ${top}, ${right}, ${bottom}]
    };
  `,

  /**
   * Select all
   */
  selectAll: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    doc.selection.selectAll();
    
    return { 
      selection: 'all'
    };
  `,

  /**
   * Deselect
   */
  deselect: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    doc.selection.deselect();
    
    return { 
      deselected: true
    };
  `,

  /**
   * Invert selection
   */
  invertSelection: () => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    doc.selection.invert();
    
    return { 
      inverted: true
    };
  `,

  /**
   * Select the main subject on the active layer (DOM selectSubject, then autoCutout fallback).
   */
  selectSubject: (sampleAllLayers = false) => `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }

    var doc = app.activeDocument;
    app.displayDialogs = DialogModes.NO;

    var subjectSelected = false;
    var method = '';
    try {
      doc.selection.selectSubject();
      subjectSelected = true;
      method = 'selectSubject';
    } catch (eDomSubject) {}

    if (!subjectSelected) {
      try {
        ${helperFunctions}
        var cutoutDesc = new ActionDescriptor();
        cutoutDesc.putBoolean(sTID('sampleAllLayers'), ${sampleAllLayers});
        executeAction(sTID('autoCutout'), cutoutDesc, DialogModes.NO);
        subjectSelected = true;
        method = 'autoCutout';
      } catch (eSelectSubject) {
        throw new Error('Select Subject is not available: ' + (eSelectSubject.message || eSelectSubject));
      }
    }

    var hasSel = false;
    try { hasSel = doc.selection.bounds != null; } catch (e) { hasSel = false; }
    if (!hasSel) {
      throw new Error('Select Subject produced no selection');
    }

    return {
      selected: true,
      method: method
    };
  `,

  /**
   * Content-aware fill on the current pixel selection.
   */
  contentAwareFill: () => `
    ${helperFunctions}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }

    var doc = app.activeDocument;
    var hasSel = false;
    try { hasSel = doc.selection.bounds != null; } catch (e) { hasSel = false; }
    if (!hasSel) {
      throw new Error('selection_required');
    }

    app.displayDialogs = DialogModes.NO;

    var desc = new ActionDescriptor();
    desc.putEnumerated(sTID('using'), sTID('fillContents'), sTID('contentAware'));
    executeAction(sTID('fill'), desc, DialogModes.NO);
    doc.selection.deselect();

    return {
      filled: true
    };
  `,

  /**
   * Create layer mask from selection
   */
  createLayerMask: (layerId?: number) => `
    ${helperFunctions}
    ${MCP_LAYER_MASK_HELPERS}
    ${MCP_LAYER_IDENTITY_HELPERS}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    ${
      typeof layerId === 'number'
        ? `// §6.8 — bind to the intended layer FIRST so the mask lands on it, not
    // whatever happens to be active (the §6.1 mask-the-wrong-layer bug fix).
    __mcp_selectLayerById(${layerId});`
        : ''
    }
    var __mcp_maskLayerId = __mcp_layerIdSafe(app.activeDocument.activeLayer);

    if (__mcp_hasLayerMaskAM()) {
      return {
        maskCreated: false,
        fromSelection: false,
        layerId: __mcp_maskLayerId,
        message: 'Layer already has a mask'
      };
    }

    var hasSelection = false;
    try { hasSelection = !!(app.activeDocument.selection.bounds); } catch (e) { hasSelection = false; }

    app.displayDialogs = DialogModes.NO;
    __mcp_makeLayerMaskAtChannel(hasSelection ? 'revealSelection' : 'revealAll');

    return {
      maskCreated: true,
      fromSelection: hasSelection,
      layerId: __mcp_maskLayerId
    };
  `,

  /**
   * Apply a linear black-to-white gradient on the active layer's mask channel.
   */
  applyGradientMask: (
    direction: GradientMaskDirection = 'bottom_to_top',
    startPct = 0,
    endPct = 100,
    angleDeg?: number
  ) => {
    const gradientEndpoints: Record<
      GradientMaskDirection,
      { fromH: number; fromV: number; toH: number; toV: number; reverse: boolean }
    > = {
      bottom_to_top: { fromH: 50, fromV: endPct, toH: 50, toV: startPct, reverse: false },
      top_to_bottom: { fromH: 50, fromV: startPct, toH: 50, toV: endPct, reverse: false },
      left_to_right: { fromH: startPct, fromV: 50, toH: endPct, toV: 50, reverse: false },
      right_to_left: { fromH: endPct, fromV: 50, toH: startPct, toV: 50, reverse: false },
    };
    const endpoints = gradientEndpoints[direction];
    const angle = angleDeg ?? (direction === 'left_to_right' || direction === 'right_to_left' ? 0 : 90);

    return `
    ${helperFunctions}
    ${MCP_LAYER_MASK_HELPERS}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }

    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    if (!layer) {
      throw new Error('No active layer');
    }

    if (!__mcp_hasLayerMaskAM()) {
      throw new Error('Active layer has no layer mask');
    }

    app.displayDialogs = DialogModes.NO;
    doc.activeLayer = layer;
    __mcp_selectLayerMaskChannel();

    var docW = doc.width.as('px');
    var docH = doc.height.as('px');
    var fromXPx = docW * (${endpoints.fromH} / 100.0);
    var fromYPx = docH * (${endpoints.fromV} / 100.0);
    var toXPx = docW * (${endpoints.toH} / 100.0);
    var toYPx = docH * (${endpoints.toV} / 100.0);
    __mcp_gradientFillLayerMask(fromXPx, fromYPx, toXPx, toYPx, ${endpoints.reverse});

    try {
      doc.activeChannels = doc.componentChannels;
    } catch (eRestore) {
      doc.activeLayer = layer;
    }

    return {
      applied: true,
      direction: '${direction}',
      angle: ${angle}
    };
  `;
  },

  /**
   * Delete layer mask
   */
  deleteLayerMask: () => `
    ${helperFunctions}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }

    var layer = app.activeDocument.activeLayer;
    if (!layer.hasLayerMask) {
      return { maskDeleted: false, message: 'Layer has no mask' };
    }

    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(cTID('Chnl'), cTID('Chnl'), cTID('Msk '));
    desc.putReference(cTID('null'), ref);
    executeAction(cTID('Dlt '), desc, DialogModes.NO);

    return {
      maskDeleted: true
    };
  `,

  /**
   * Apply layer mask
   */
  applyLayerMask: () => `
    ${helperFunctions}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }

    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(sTID('channel'), sTID('ordinal'), sTID('targetEnum'));
    desc.putReference(sTID('null'), ref);
    desc.putBoolean(sTID('apply'), true);
    try {
      executeAction(sTID('delete'), desc, DialogModes.NO);
    } catch (eDeleteApply) {
      var legacy = new ActionDescriptor();
      var legacyRef = new ActionReference();
      legacyRef.putEnumerated(cTID('Chnl'), cTID('Chnl'), cTID('Msk '));
      legacy.putReference(cTID('null'), legacyRef);
      executeAction(cTID('Aply'), legacy, DialogModes.NO);
    }

    return {
      maskApplied: true
    };
  `,

  /**
   * Play an action from Actions palette
   */
  playAction: (actionName: string, actionSetName: string) => `
    app.doAction("${jsString(actionName)}", "${jsString(actionSetName)}");
    
    return { 
      action: '${actionName}',
      set: '${actionSetName}'
    };
  `,

  /**
   * Execute custom JavaScript code
   */
  executeCustomScript: (code: string) => `
    ${code}
  `,

  /**
   * Rasterize active layer
   */
  rasterizeLayer: () => `
    ${helperFunctions}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var layer = app.activeDocument.activeLayer;

    if (layer.typename === 'LayerSet') {
      throw new Error('Cannot rasterize a layer group — select a single layer');
    }

    var originalKind = String(layer.kind);
    if (layer.kind === LayerKind.NORMAL) {
      return {
        message: 'Layer is already rasterized',
        kind: 'NORMAL'
      };
    }

    if (layer.kind === LayerKind.TEXT) {
      layer.rasterize(RasterizeType.TEXTCONTENTS);
    } else if (layer.kind === LayerKind.SMARTOBJECT) {
      var desc = new ActionDescriptor();
      var ref = new ActionReference();
      ref.putEnumerated(sTID('layer'), sTID('ordinal'), sTID('targetEnum'));
      desc.putReference(sTID('null'), ref);
      executeAction(sTID('rasterizePlaced'), desc, DialogModes.NO);
    } else {
      try {
        layer.rasterize(RasterizeType.ENTIRELAYER);
      } catch (eDom) {
        var desc2 = new ActionDescriptor();
        var ref2 = new ActionReference();
        ref2.putEnumerated(sTID('layer'), sTID('ordinal'), sTID('targetEnum'));
        desc2.putReference(sTID('null'), ref2);
        executeAction(sTID('rasterizeLayer'), desc2, DialogModes.NO);
      }
    }

    return {
      rasterized: true,
      originalKind: originalKind,
      newKind: 'NORMAL'
    };
  `,

  /**
   * Undo last operation (step backward in history)
   */
  undo: (steps = 1) => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    
    // Get current history state index
    var currentIndex = -1;
    for (var i = 0; i < doc.historyStates.length; i++) {
      if (doc.historyStates[i] === doc.activeHistoryState) {
        currentIndex = i;
        break;
      }
    }
    
    if (currentIndex === -1) {
      throw new Error('Could not find current history state');
    }
    
    // Calculate target index
    var targetIndex = Math.max(0, currentIndex - ${steps});
    
    // Set active history state to go back
    if (targetIndex < doc.historyStates.length) {
      doc.activeHistoryState = doc.historyStates[targetIndex];
    }
    
    var result = {
      undone: true,
      steps: currentIndex - targetIndex,
      currentHistoryState: doc.activeHistoryState.name,
      remainingStates: currentIndex - targetIndex,
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Redo operation (step forward in history)
   */
  redo: (steps = 1) => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    
    // Get current history state index
    var currentIndex = -1;
    for (var i = 0; i < doc.historyStates.length; i++) {
      if (doc.historyStates[i] === doc.activeHistoryState) {
        currentIndex = i;
        break;
      }
    }
    
    if (currentIndex === -1) {
      throw new Error('Could not find current history state');
    }
    
    // Calculate target index
    var targetIndex = Math.min(doc.historyStates.length - 1, currentIndex + ${steps});
    
    // Set active history state to go forward
    if (targetIndex >= 0) {
      doc.activeHistoryState = doc.historyStates[targetIndex];
    }
    
    var result = {
      redone: true,
      steps: targetIndex - currentIndex,
      currentHistoryState: doc.activeHistoryState.name,
      availableRedoSteps: doc.historyStates.length - 1 - targetIndex,
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Get history states
   */
  getHistoryStates: () => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    
    var states = [];
    var currentIndex = -1;
    
    for (var i = 0; i < doc.historyStates.length; i++) {
      var state = doc.historyStates[i];
      states.push({
        name: state.name,
        snapshot: state.snapshot || false
      });
      
      if (state === doc.activeHistoryState) {
        currentIndex = i;
      }
    }
    
    var result = {
      totalStates: states.length,
      currentIndex: currentIndex,
      currentState: currentIndex >= 0 ? states[currentIndex].name : 'Unknown',
      canUndo: currentIndex > 0,
      canRedo: currentIndex < states.length - 1,
      states: states,
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Move layer to specific position (reorder)
   */
  moveLayerToPosition: (targetLayerName: string, position: string) => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var activeLayer = doc.activeLayer;
    
    // Find target layer
    var targetLayer = null;
    for (var i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i].name === "${jsString(targetLayerName)}") {
        targetLayer = doc.layers[i];
        break;
      }
    }
    
    if (!targetLayer) {
      throw new Error('Target layer not found: ${targetLayerName}');
    }
    
    // Determine ElementPlacement
    var placement;
    if ("${position}" === "ABOVE") {
      placement = ElementPlacement.PLACEBEFORE;
    } else if ("${position}" === "BELOW") {
      placement = ElementPlacement.PLACEAFTER;
    } else if ("${position}" === "TOP") {
      placement = ElementPlacement.PLACEATBEGINNING;
    } else if ("${position}" === "BOTTOM") {
      placement = ElementPlacement.PLACEATEND;
    } else {
      throw new Error('Invalid position. Use: ABOVE, BELOW, TOP, or BOTTOM');
    }
    
    // Move the layer
    activeLayer.move(targetLayer, placement);
    
    var result = {
      moved: true,
      layerName: activeLayer.name,
      position: "${position}",
      relativeTo: targetLayer.name,
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Move layer to top of layer stack
   */
  moveLayerToTop: () => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    if (doc.layers.length > 0) {
      layer.move(doc.layers[0], ElementPlacement.PLACEBEFORE);
    }
    
    var result = {
      moved: true,
      layerName: layer.name,
      position: 'top',
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Move layer to bottom of layer stack
   */
  moveLayerToBottom: () => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;

    if (layer.isBackgroundLayer) {
      throw new Error('Cannot move background layer');
    }

    if (doc.layers.length > 0) {
      var bottomLayer = doc.layers[doc.layers.length - 1];
      layer.move(bottomLayer, ElementPlacement.PLACEBEFORE);
    }
    
    var result = {
      moved: true,
      layerName: layer.name,
      position: 'bottom',
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Move layer up one position
   */
  moveLayerUp: () => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    // Find current layer index
    var currentIndex = -1;
    for (var i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i] === layer) {
        currentIndex = i;
        break;
      }
    }
    
    if (currentIndex <= 0) {
      return {
        moved: false,
        message: 'Layer is already at the top',
        context: getContextInfo()
      };
    }
    
    // Move before the layer above
    layer.move(doc.layers[currentIndex - 1], ElementPlacement.PLACEBEFORE);
    
    var result = {
      moved: true,
      layerName: layer.name,
      direction: 'up',
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Move layer down one position
   */
  moveLayerDown: () => `
    ${getContextInfo}
    
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    
    // Find current layer index
    var currentIndex = -1;
    for (var i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i] === layer) {
        currentIndex = i;
        break;
      }
    }
    
    if (currentIndex === -1 || currentIndex >= doc.layers.length - 1) {
      return {
        moved: false,
        message: 'Layer is already at the bottom',
        context: getContextInfo()
      };
    }
    
    // Move after the layer below
    layer.move(doc.layers[currentIndex + 1], ElementPlacement.PLACEAFTER);
    
    var result = {
      moved: true,
      layerName: layer.name,
      direction: 'down',
      context: getContextInfo()
    };
    return result;
  `,

  /**
   * Lightweight session state snapshot (read-only).
   */
  getState: () => `
    ${getContextInfo}
    return getContextInfo();
  `,

  /**
   * Export a JPEG preview to the system temp folder. Returns filesystem path for Node to read.
   */
  exportPreview: (maxDimension = 1024, jpegQuality = 8) => `
    ${getContextInfo}

    if (app.documents.length === 0) {
      throw new Error('No active document');
    }

    var doc = app.activeDocument;
    var w = doc.width.as('px');
    var h = doc.height.as('px');
    var maxDim = ${maxDimension};
    var scale = 1;
    if (w > maxDim || h > maxDim) {
      scale = maxDim / Math.max(w, h);
    }

    var dup = doc.duplicate('__mcp_preview__', true);
    if (scale < 1) {
      dup.resizeImage(
        UnitValue(Math.round(w * scale), 'px'),
        UnitValue(Math.round(h * scale), 'px'),
        doc.resolution,
        ResampleMethod.BICUBIC
      );
    }

    var tmpFile = new File(Folder.temp.fsName + '/ps-preview-' + (new Date().getTime()) + '.jpg');
    var saveOptions = new JPEGSaveOptions();
    saveOptions.quality = ${jpegQuality};
    saveOptions.embedColorProfile = true;
    saveOptions.formatOptions = FormatOptions.STANDARDBASELINE;
    dup.flatten();
    dup.saveAs(tmpFile, saveOptions, true);
    dup.close(SaveOptions.DONOTSAVECHANGES);

    return {
      path: tmpFile.fsName,
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      mimeType: 'image/jpeg'
    };
  `,

  /**
   * Shared helpers for Firefly generative actions via Action Manager.
   * See docs/plans/2026-07-03-1149-photoshop-ai-features/ and scripts/spike-photoshop-actions.ts.
   */
  generativeHelpers: () => `
    ${helperFunctions}

    function __mcp_tryGenerativeAction(actionIds, buildDesc) {
      var lastError = '';
      for (var i = 0; i < actionIds.length; i++) {
        var actionId = actionIds[i];
        try {
          var desc = buildDesc ? buildDesc(actionId) : new ActionDescriptor();
          executeAction(sTID(actionId), desc, DialogModes.NO);
          return { ok: true, action_id: actionId };
        } catch (e) {
          lastError = actionId + ': ' + (e.message || String(e));
        }
      }
      return { ok: false, error: lastError || 'No generative action succeeded' };
    }

    function __mcp_waitGenerativeComplete(doc, baselineHist, maxWaitMs) {
      var waited = 0;
      var step = 500;
      var maxMs = maxWaitMs || 90000;
      var baseline = baselineHist;
      while (waited < maxMs) {
        try {
          if (doc.historyStates.length > baseline + 1) {
            return { completed: true, waited_ms: waited, history_states: doc.historyStates.length };
          }
        } catch (e) {}
        $.sleep(step);
        waited += step;
      }
      return { completed: false, waited_ms: waited, history_states: doc.historyStates.length };
    }

    function __mcp_hasSelection(doc) {
      try { return doc.selection.bounds != null; } catch (e) { return false; }
    }
  `,

  generativeFill: (prompt: string) => {
    const escaped = jsString(prompt);
    return `
      ${helperFunctions}
      ${ExtendScriptSnippets.generativeHelpers()}

      if (app.documents.length === 0) throw new Error('No active document');
      var doc = app.activeDocument;
      app.displayDialogs = DialogModes.NO;

      if (!__mcp_hasSelection(doc)) {
        return { ok: false, code: 'generative_no_selection', message: 'Active pixel selection required for generative fill' };
      }

      var baselineHist = doc.activeHistoryState.index;
      var result = __mcp_tryGenerativeAction(
        ['generativeFill', 'generativeLayerFill', 'firefly'],
        function(actionId) {
          var desc = new ActionDescriptor();
          try { desc.putString(sTID('prompt'), ${escaped}); } catch (eP) {}
          try { desc.putString(sTID('text'), ${escaped}); } catch (eT) {}
          try { desc.putString(sTID('promptText'), ${escaped}); } catch (ePT) {}
          return desc;
        }
      );

      if (!result.ok) {
        var msg = String(result.error || '');
        if (/credit|quota|sign in|subscription/i.test(msg)) {
          return { ok: false, code: 'generative_credits_exhausted', message: msg };
        }
        return { ok: false, code: 'generative_unavailable', message: msg };
      }

      var wait = __mcp_waitGenerativeComplete(doc, baselineHist, 90000);
      try { doc.selection.deselect(); } catch (eDesel) {}

      return {
        ok: true,
        summary: 'Generative fill invoked via ' + result.action_id,
        details: { action_id: result.action_id, prompt: ${escaped}, wait },
        next_suggested_tool: 'photoshop_get_preview'
      };
    `;
  },

  generativeRemove: (featherPx: number, autoSelectSubject: boolean) => `
    ${helperFunctions}
    ${ExtendScriptSnippets.generativeHelpers()}

    if (app.documents.length === 0) throw new Error('No active document');
    var doc = app.activeDocument;
    app.displayDialogs = DialogModes.NO;

    var hasSel = __mcp_hasSelection(doc);
    if (!hasSel && ${autoSelectSubject ? 'true' : 'false'}) {
      try {
        doc.selection.selectSubject();
        hasSel = __mcp_hasSelection(doc);
      } catch (eSub) {}
    }
    if (!hasSel) {
      return { ok: false, code: 'generative_no_selection', message: 'Selection required for generative remove' };
    }

    if (${featherPx} > 0) {
      try { doc.selection.feather(${featherPx}); } catch (eF) {}
    }

    var baselineHist = doc.activeHistoryState.index;
    var result = __mcp_tryGenerativeAction(
      ['removeTool', 'generativeFill', 'spotHealingBrush'],
      function(actionId) {
        var desc = new ActionDescriptor();
        if (actionId === 'generativeFill') {
          try { desc.putString(sTID('prompt'), 'remove'); } catch (eP) {}
        }
        return desc;
      }
    );

    if (!result.ok) {
      return { ok: false, code: 'generative_unavailable', message: String(result.error || '') };
    }

    var wait = __mcp_waitGenerativeComplete(doc, baselineHist, 90000);
    try { doc.selection.deselect(); } catch (eDesel) {}

    return {
      ok: true,
      summary: 'Generative remove invoked via ' + result.action_id,
      details: { action_id: result.action_id, feather_px: ${featherPx}, wait },
      next_suggested_tool: 'photoshop_get_preview'
    };
  `,

  generativeExpand: (direction: string, prompt: string) => {
    const escaped = jsString(prompt);
    const dir = jsString(direction);
    return `
      ${helperFunctions}
      ${ExtendScriptSnippets.generativeHelpers()}

      if (app.documents.length === 0) throw new Error('No active document');
      var doc = app.activeDocument;
      app.displayDialogs = DialogModes.NO;

      var baselineHist = doc.activeHistoryState.index;
      var result = __mcp_tryGenerativeAction(
        ['generativeExpand', 'expandCanvas', 'generativeCanvasExpand'],
        function(actionId) {
          var desc = new ActionDescriptor();
          try { desc.putString(sTID('prompt'), ${escaped}); } catch (eP) {}
          try { desc.putString(sTID('direction'), ${dir}); } catch (eD) {}
          return desc;
        }
      );

      if (!result.ok) {
        return { ok: false, code: 'generative_unavailable', message: String(result.error || '') };
      }

      var wait = __mcp_waitGenerativeComplete(doc, baselineHist, 120000);

      return {
        ok: true,
        summary: 'Generative expand invoked via ' + result.action_id,
        details: { action_id: result.action_id, direction: ${dir}, prompt: ${escaped}, wait },
        next_suggested_tool: 'photoshop_get_preview'
      };
    `;
  },

  generativeUpscale: (targetScale: number) => `
    ${helperFunctions}
    ${ExtendScriptSnippets.generativeHelpers()}

    if (app.documents.length === 0) throw new Error('No active document');
    var doc = app.activeDocument;
    app.displayDialogs = DialogModes.NO;

    var baselineHist = doc.activeHistoryState.index;
    var result = __mcp_tryGenerativeAction(
      ['generativeUpscale', 'superResolution', 'enhanceDetail'],
      function(actionId) {
        var desc = new ActionDescriptor();
        try { desc.putInteger(sTID('scale'), ${targetScale}); } catch (eS) {}
        return desc;
      }
    );

    if (!result.ok) {
      return { ok: false, code: 'generative_unavailable', message: String(result.error || '') };
    }

    var wait = __mcp_waitGenerativeComplete(doc, baselineHist, 120000);

    return {
      ok: true,
      summary: 'Generative upscale invoked via ' + result.action_id,
      details: { action_id: result.action_id, target_scale: ${targetScale}, wait },
      next_suggested_tool: 'photoshop_get_preview'
    };
  `,

  skyReplacement: (skyImagePath: string) => {
    const escaped = jsString(skyImagePath);
    return `
      ${helperFunctions}
      ${ExtendScriptSnippets.generativeHelpers()}

      if (app.documents.length === 0) throw new Error('No active document');
      var doc = app.activeDocument;
      app.displayDialogs = DialogModes.NO;

      var skyFile = new File(${escaped});
      var baselineHist = doc.activeHistoryState.index;
      var result = __mcp_tryGenerativeAction(
        ['skyReplacement', 'replaceSky', 'replaceSkyBackground'],
        function(actionId) {
          var desc = new ActionDescriptor();
          if (skyFile.exists) {
            try { desc.putPath(sTID('skyImage'), skyFile); } catch (eP) {}
            try { desc.putPath(sTID('null'), skyFile); } catch (eN) {}
          }
          return desc;
        }
      );

      if (!result.ok) {
        return { ok: false, code: 'generative_unavailable', message: String(result.error || '') };
      }

      var wait = __mcp_waitGenerativeComplete(doc, baselineHist, 120000);

      return {
        ok: true,
        summary: 'Sky replacement invoked via ' + result.action_id,
        details: { action_id: result.action_id, sky_image_path: ${escaped}, wait },
        next_suggested_tool: 'photoshop_get_preview'
      };
    `;
  },

  generateImage: (prompt: string, width: number, height: number) => {
    const escaped = jsString(prompt);
    return `
      ${helperFunctions}
      ${ExtendScriptSnippets.generativeHelpers()}

      app.displayDialogs = DialogModes.NO;

      var doc;
      if (app.documents.length === 0) {
        doc = app.documents.add(
          UnitValue(${width}, 'px'),
          UnitValue(${height}, 'px'),
          72,
          'Generated',
          NewDocumentMode.RGB,
          DocumentFill.WHITE
        );
      } else {
        doc = app.activeDocument;
      }

      var baselineHist = doc.activeHistoryState.index;
      var result = __mcp_tryGenerativeAction(
        ['textToImage', 'generateImage', 'fireflyTextToImage', 'generativeFill'],
        function(actionId) {
          var desc = new ActionDescriptor();
          try { desc.putString(sTID('prompt'), ${escaped}); } catch (eP) {}
          try { desc.putString(sTID('text'), ${escaped}); } catch (eT) {}
          return desc;
        }
      );

      if (!result.ok) {
        return { ok: false, code: 'generative_unavailable', message: String(result.error || '') };
      }

      var wait = __mcp_waitGenerativeComplete(doc, baselineHist, 120000);

      return {
        ok: true,
        summary: 'Generate image invoked via ' + result.action_id,
        details: { action_id: result.action_id, prompt: ${escaped}, width: ${width}, height: ${height}, wait },
        next_suggested_tool: 'photoshop_get_preview'
      };
    `;
  },
};

/**
 * Fill / gradient / pattern / paint helpers (Tier-2 fill-paint tools).
 *
 * Atomic drawing primitives used by src/tools/fill-paint-tools.ts:
 *   - __mcp_applyGradient        — draw a gradient (linear/radial/angle/reflected/diamond)
 *                                  across the active layer, OR make a Gradient fill layer.
 *   - __mcp_applyPatternFill     — Pattern fill layer, OR draw a pattern onto pixels.
 *   - __mcp_addSolidFillLayer    — Solid Color fill layer (non-destructive).
 *   - __mcp_strokeSelection      — stroke the active selection edge.
 *   - __mcp_fillSelectionWith    — fill the active selection from a named source.
 *
 * Descriptor shapes are cribbed from the layer-style gradient-overlay descriptor
 * (__mcp_buildGradientOverlay above), the mask gradient-draw helper
 * (__mcp_gradientFillLayerMask), and the UXP batchPlay reference in ~/adb-mcp
 * (uxp/ps/commands/selection.js `fillSelection`, `stroke`). batchPlay JSON maps 1:1
 * onto these ActionDescriptor putX calls.
 *
 * sTID/cTID come from RECIPE_ACTION_HELPERS (the suspendHistory wrap), so every tool
 * that uses these helpers must run through executeRecipe. Each helper performs exactly
 * one Photoshop operation (or a make + set pair), collapsing to a single undo.
 *
 * RGBColor QUIRK: __mcp_fpRgbColor writes the GREEN channel under the key `grain`
 * (Action Manager quirk) — same as the layer-style / adjustment-layer helpers.
 */
export const MCP_FILL_PAINT_HELPERS = `
/** Map a friendly blend-mode name to its Action Manager blendMode enum string. */
function __mcp_fpBlendModeStr(name) {
  var map = {
    NORMAL: 'normal', DISSOLVE: 'dissolve', DARKEN: 'darken', MULTIPLY: 'multiply',
    COLORBURN: 'colorBurn', LINEARBURN: 'linearBurn', DARKERCOLOR: 'darkerColor',
    LIGHTEN: 'lighten', SCREEN: 'screen', COLORDODGE: 'colorDodge',
    LINEARDODGE: 'linearDodge', LIGHTERCOLOR: 'lighterColor', OVERLAY: 'overlay',
    SOFTLIGHT: 'softLight', HARDLIGHT: 'hardLight', VIVIDLIGHT: 'vividLight',
    LINEARLIGHT: 'linearLight', PINLIGHT: 'pinLight', HARDMIX: 'hardMix',
    DIFFERENCE: 'difference', EXCLUSION: 'exclusion', SUBTRACT: 'blendSubtraction',
    DIVIDE: 'blendDivide', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color',
    LUMINOSITY: 'luminosity'
  };
  var key = String(name).toUpperCase();
  return map[key] || 'normal';
}

function __mcp_fpClampNum(v, min, max) {
  if (typeof v !== 'number' || isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/** Apply blendMode + opacity to a just-created fill/content layer (the active layer). */
function __mcp_fpApplyLayerLook(layer, blendModeName, opacity) {
  var blend = __mcp_fpBlendModeStr(blendModeName);
  if (blend !== 'normal') {
    var setDesc = new ActionDescriptor();
    var setRef = new ActionReference();
    setRef.putEnumerated(sTID('layer'), sTID('ordinal'), sTID('targetEnum'));
    setDesc.putReference(sTID('null'), setRef);
    var props = new ActionDescriptor();
    props.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(blend));
    setDesc.putObject(sTID('to'), sTID('layer'), props);
    try { executeAction(sTID('set'), setDesc, DialogModes.NO); } catch (eBl) {}
  }
  if (typeof opacity === 'number' && opacity < 100) {
    try { layer.opacity = opacity; } catch (eOp) {}
  }
}

/** Build an RGBColor descriptor. NOTE: green channel uses key "grain" (AM quirk). */
function __mcp_fpRgbColor(red, green, blue) {
  var c = new ActionDescriptor();
  c.putDouble(sTID('red'), red);
  c.putDouble(sTID('grain'), green);
  c.putDouble(sTID('blue'), blue);
  return c;
}

/** Throw unless the active document is RGB (fill/paint tools assume RGB channels). */
function __mcp_fpAssertRgb() {
  if (app.documents.length === 0) {
    throw new Error('No active document. Open or create a document first.');
  }
  var doc = app.activeDocument;
  if (doc.mode !== DocumentMode.RGB) {
    throw new Error(
      'This tool requires an RGB document. Active document mode is ' + String(doc.mode) +
      '. Convert to RGB (Image > Mode > RGB Color) first.'
    );
  }
  return doc;
}

/** Assert (and return) a pixel/normal active layer for destructive paint. Un-backgrounds it. */
function __mcp_fpAssertPixelLayer() {
  var doc = app.activeDocument;
  var layer = doc.activeLayer;
  if (!layer) {
    throw new Error('No active layer. Select a layer first.');
  }
  if (layer.typename === 'LayerSet') {
    throw new Error('Active item is a layer group — select a pixel/normal layer first.');
  }
  if (layer.kind !== LayerKind.NORMAL) {
    throw new Error(
      'This tool paints pixels and needs a normal (raster) active layer. The active layer kind is ' +
      String(layer.kind) + '. Rasterize it or select a pixel layer first.'
    );
  }
  if (layer.isBackgroundLayer) {
    try { layer.isBackgroundLayer = false; } catch (eBg) {}
  }
  return layer;
}

/** True if the active document currently has a selection with bounds. */
function __mcp_fpHasSelection() {
  try { return !!app.activeDocument.selection.bounds; } catch (eSel) { return false; }
}

/** Assert an active selection exists (for stroke/fill selection tools). */
function __mcp_fpAssertSelection() {
  if (!__mcp_fpHasSelection()) {
    throw new Error('This tool requires an active selection. Make a selection first (e.g. photoshop_select_rectangle).');
  }
}

/**
 * Build a gradientClassEvent descriptor from a stops array [{r,g,b,location 0-100}].
 * Locations map 0..100 -> 0..4096 (the Action Manager gradient location scale).
 */
function __mcp_fpBuildGradient(stops) {
  var gradient = new ActionDescriptor();
  gradient.putString(sTID('name'), 'Custom');
  gradient.putEnumerated(sTID('gradientForm'), sTID('gradientForm'), sTID('customStops'));
  gradient.putDouble(sTID('interfaceIconFrameDimmed'), 4096.0);

  var colors = new ActionList();
  for (var i = 0; i < stops.length; i++) {
    var s = stops[i];
    var loc = Math.round(__mcp_fpClampNum(s.location, 0, 100) / 100 * 4096);
    var stop = new ActionDescriptor();
    stop.putObject(sTID('color'), sTID('RGBColor'), __mcp_fpRgbColor(s.r, s.g, s.b));
    stop.putEnumerated(sTID('type'), sTID('colorStopType'), sTID('userStop'));
    stop.putInteger(sTID('location'), loc);
    stop.putInteger(sTID('midpoint'), 50);
    colors.putObject(sTID('colorStop'), stop);
  }
  gradient.putList(sTID('colors'), colors);

  // Opaque transparency stops at each end (gradient tool requires a transparency list).
  var transparency = new ActionList();
  var tA = new ActionDescriptor();
  tA.putUnitDouble(sTID('opacity'), sTID('percentUnit'), 100.0);
  tA.putInteger(sTID('location'), 0);
  tA.putInteger(sTID('midpoint'), 50);
  transparency.putObject(sTID('transferSpec'), tA);
  var tB = new ActionDescriptor();
  tB.putUnitDouble(sTID('opacity'), sTID('percentUnit'), 100.0);
  tB.putInteger(sTID('location'), 4096);
  tB.putInteger(sTID('midpoint'), 50);
  transparency.putObject(sTID('transferSpec'), tB);
  gradient.putList(sTID('transparency'), transparency);
  return gradient;
}

function __mcp_fpGradientTypeEnum(type) {
  var map = { linear: 'linear', radial: 'radial', angle: 'angle', reflected: 'reflected', diamond: 'diamond' };
  return map[String(type)] || 'linear';
}

/**
 * Draw a gradient across the active layer, or make a Gradient fill (content) layer.
 * opts: type, stops[], angle, scale, reverse, dither, opacity, blendMode, asFillLayer.
 * Returns { layer_name }.
 */
function __mcp_applyGradient(opts) {
  var doc = __mcp_fpAssertRgb();
  var gradient = __mcp_fpBuildGradient(opts.stops);
  var typeEnum = __mcp_fpGradientTypeEnum(opts.type);

  if (opts.asFillLayer) {
    // Non-destructive Gradient fill content layer: make contentLayer -> type gradientLayer.
    var makeDesc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(sTID('contentLayer'));
    makeDesc.putReference(sTID('null'), ref);
    var typeDesc = new ActionDescriptor();
    var gfill = new ActionDescriptor();
    gfill.putUnitDouble(sTID('angle'), sTID('angleUnit'), opts.angle);
    gfill.putEnumerated(sTID('type'), sTID('gradientType'), sTID(typeEnum));
    gfill.putBoolean(sTID('reverse'), !!opts.reverse);
    gfill.putBoolean(sTID('dither'), !!opts.dither);
    gfill.putBoolean(sTID('align'), true);
    gfill.putUnitDouble(sTID('scale'), sTID('percentUnit'), __mcp_fpClampNum(opts.scale, 10, 150));
    gfill.putObject(sTID('gradient'), sTID('gradientClassEvent'), gradient);
    typeDesc.putObject(sTID('type'), sTID('gradientLayer'), gfill);
    makeDesc.putObject(sTID('using'), sTID('contentLayer'), typeDesc);
    // A live selection would mask the fill layer to it; this tool's fill-layer mode is
    // documented to cover the whole layer, so drop any selection first.
    if (__mcp_fpHasSelection()) { try { doc.selection.deselect(); } catch (eDs) {} }
    executeAction(sTID('make'), makeDesc, DialogModes.NO);
    var flLayer = doc.activeLayer;
    __mcp_fpApplyLayerLook(flLayer, opts.blendMode, opts.opacity);
    return { layer_name: flLayer.name };
  }

  // Destructive draw onto the active pixel layer via the gradient (Grdn) event.
  var layer = __mcp_fpAssertPixelLayer();
  var b = doc.selection && __mcp_fpHasSelection() ? doc.selection.bounds : null;
  // Endpoints: use the selection bounds when present, else the whole canvas. The angle
  // rotates the from->to vector about the region center.
  var x0, y0, x1, y1;
  if (b) {
    x0 = b[0].as('px'); y0 = b[1].as('px'); x1 = b[2].as('px'); y1 = b[3].as('px');
  } else {
    x0 = 0; y0 = 0; x1 = doc.width.as('px'); y1 = doc.height.as('px');
  }
  var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  var halfW = (x1 - x0) / 2, halfH = (y1 - y0) / 2;
  var rad = (opts.angle) * Math.PI / 180;
  // PS angle: 0deg points right, positive is counter-clockwise (y grows downward).
  var dx = Math.cos(rad), dy = -Math.sin(rad);
  // Project the region half-extents onto the gradient direction so the from->to line
  // spans the full region at any angle (an inscribed halfW/halfH span would fall short
  // on diagonals of non-square regions).
  var span = halfW * Math.abs(dx) + halfH * Math.abs(dy);
  var fromX = cx - dx * span, fromY = cy - dy * span;
  var toX = cx + dx * span, toY = cy + dy * span;

  // Point objects use charID 'Pnt ' with 'Hrzn'/'Vrtc' (matches __mcp_pointDescPx).
  var args = new ActionDescriptor();
  var fromPt = new ActionDescriptor();
  fromPt.putUnitDouble(cTID('Hrzn'), cTID('#Pxl'), fromX);
  fromPt.putUnitDouble(cTID('Vrtc'), cTID('#Pxl'), fromY);
  args.putObject(sTID('from'), cTID('Pnt '), fromPt);
  var toPt = new ActionDescriptor();
  toPt.putUnitDouble(cTID('Hrzn'), cTID('#Pxl'), toX);
  toPt.putUnitDouble(cTID('Vrtc'), cTID('#Pxl'), toY);
  args.putObject(sTID('to'), cTID('Pnt '), toPt);
  args.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_fpBlendModeStr(opts.blendMode)));
  args.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_fpClampNum(opts.opacity, 0, 100));
  args.putEnumerated(sTID('type'), sTID('gradientType'), sTID(typeEnum));
  args.putBoolean(sTID('dither'), !!opts.dither);
  args.putBoolean(sTID('reverse'), !!opts.reverse);
  args.putObject(sTID('gradient'), sTID('gradientClassEvent'), gradient);
  executeAction(sTID('gradientClassEvent'), args, DialogModes.NO);
  return { layer_name: layer.name };
}

/** Resolve a pattern preset by (case-insensitive substring) name. Returns { ID, name } or throws. */
function __mcp_fpResolvePattern(patternName) {
  var pats = app.patterns;
  if (!pats || pats.length === 0) {
    throw new Error('No pattern presets are loaded. Load a pattern set in Photoshop (Edit > Presets) first.');
  }
  if (patternName && String(patternName).length) {
    var needle = String(patternName).toLowerCase();
    for (var i = 0; i < pats.length; i++) {
      var nm = pats[i].name || '';
      if (nm.toLowerCase().indexOf(needle) !== -1) {
        return { id: pats[i].ID, name: nm };
      }
    }
    throw new Error('No loaded pattern preset matches "' + patternName + '". Available count: ' + pats.length + '.');
  }
  return { id: pats[0].ID, name: pats[0].name || 'Pattern 1' };
}

/** Build a pattern descriptor (name + ID) for use as a fill's pattern value. */
function __mcp_fpPatternDesc(pat) {
  if (!pat.id) {
    throw new Error('Resolved pattern has no ID — cannot reference it. Try a different pattern preset.');
  }
  var d = new ActionDescriptor();
  d.putString(sTID('name'), String(pat.name || 'Pattern'));
  d.putString(sTID('ID'), String(pat.id));
  return d;
}

/**
 * Pattern fill layer, or draw a pattern onto the active pixel layer.
 * opts: patternName, scale, opacity, blendMode, asFillLayer. Returns { layer_name, pattern_name }.
 */
function __mcp_applyPatternFill(opts) {
  var doc = __mcp_fpAssertRgb();
  var pat = __mcp_fpResolvePattern(opts.patternName);

  if (opts.asFillLayer) {
    var makeDesc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(sTID('contentLayer'));
    makeDesc.putReference(sTID('null'), ref);
    var typeDesc = new ActionDescriptor();
    var pfill = new ActionDescriptor();
    pfill.putObject(sTID('pattern'), sTID('pattern'), __mcp_fpPatternDesc(pat));
    pfill.putUnitDouble(sTID('scale'), sTID('percentUnit'), __mcp_fpClampNum(opts.scale, 1, 1000));
    pfill.putBoolean(sTID('align'), true);
    typeDesc.putObject(sTID('type'), sTID('patternLayer'), pfill);
    makeDesc.putObject(sTID('using'), sTID('contentLayer'), typeDesc);
    if (__mcp_fpHasSelection()) { try { doc.selection.deselect(); } catch (eDs) {} }
    executeAction(sTID('make'), makeDesc, DialogModes.NO);
    var flLayer = doc.activeLayer;
    __mcp_fpApplyLayerLook(flLayer, opts.blendMode, opts.opacity);
    return { layer_name: flLayer.name, pattern_name: pat.name };
  }

  var layer = __mcp_fpAssertPixelLayer();
  var fillDesc = new ActionDescriptor();
  fillDesc.putEnumerated(sTID('using'), sTID('fillContents'), sTID('pattern'));
  fillDesc.putObject(sTID('pattern'), sTID('pattern'), __mcp_fpPatternDesc(pat));
  fillDesc.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_fpBlendModeStr(opts.blendMode)));
  fillDesc.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_fpClampNum(opts.opacity, 0, 100));
  executeAction(sTID('fill'), fillDesc, DialogModes.NO);
  return { layer_name: layer.name, pattern_name: pat.name };
}

/**
 * Solid Color fill layer (non-destructive). If a selection is active, the fill layer is
 * created clipped to it (make contentLayer honors the active selection as its mask).
 * opts: red, green, blue, opacity, blendMode, name. Returns { layer_name, clipped_to_selection }.
 */
function __mcp_addSolidFillLayer(opts) {
  var doc = __mcp_fpAssertRgb();
  var hadSelection = __mcp_fpHasSelection();
  var makeDesc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putClass(sTID('contentLayer'));
  makeDesc.putReference(sTID('null'), ref);
  var typeDesc = new ActionDescriptor();
  var color = new ActionDescriptor();
  color.putObject(sTID('color'), sTID('RGBColor'), __mcp_fpRgbColor(opts.red, opts.green, opts.blue));
  typeDesc.putObject(sTID('type'), sTID('solidColorLayer'), color);
  makeDesc.putObject(sTID('using'), sTID('contentLayer'), typeDesc);
  executeAction(sTID('make'), makeDesc, DialogModes.NO);
  var layer = doc.activeLayer;
  try { if (opts.name) { layer.name = opts.name; } } catch (eNm) {}
  __mcp_fpApplyLayerLook(layer, opts.blendMode, opts.opacity);
  return { layer_name: layer.name, clipped_to_selection: !!hadSelection };
}

/** Map a stroke location name to the stroke event's strokeLength enum value. */
function __mcp_fpStrokeLocationEnum(location) {
  var map = { inside: 'inside', center: 'center', outside: 'outside' };
  return map[String(location)] || 'center';
}

/**
 * Stroke the active selection edge on the active pixel layer via the stroke event.
 * opts: width, location, red, green, blue, opacity, blendMode. Returns layer name.
 */
function __mcp_strokeSelection(opts) {
  __mcp_fpAssertRgb();
  __mcp_fpAssertSelection();
  var layer = __mcp_fpAssertPixelLayer();
  var d = new ActionDescriptor();
  d.putInteger(sTID('width'), Math.round(Math.max(1, opts.width)));
  d.putEnumerated(sTID('location'), sTID('strokeLength'), sTID(__mcp_fpStrokeLocationEnum(opts.location)));
  d.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_fpClampNum(opts.opacity, 0, 100));
  d.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_fpBlendModeStr(opts.blendMode)));
  d.putObject(sTID('color'), sTID('RGBColor'), __mcp_fpRgbColor(opts.red, opts.green, opts.blue));
  executeAction(sTID('stroke'), d, DialogModes.NO);
  return layer.name;
}

/** Map a fill source name to the fillContents enum (and whether it needs a color). */
function __mcp_fpFillSourceEnum(source) {
  var s = String(source).toLowerCase();
  if (s === 'foreground') return 'foregroundColor';
  if (s === 'background') return 'backgroundColor';
  if (s === 'black') return 'black';
  if (s === 'white') return 'white';
  if (s === 'gray' || s === '50gray') return 'gray';
  return 'color';
}

/**
 * Fill the active selection on the active pixel layer via the fill event.
 * opts: source, red, green, blue, opacity, blendMode. Returns layer name.
 */
function __mcp_fillSelectionWith(opts) {
  __mcp_fpAssertRgb();
  __mcp_fpAssertSelection();
  var layer = __mcp_fpAssertPixelLayer();
  var usingEnum = __mcp_fpFillSourceEnum(opts.source);
  var d = new ActionDescriptor();
  d.putEnumerated(sTID('using'), sTID('fillContents'), sTID(usingEnum));
  if (usingEnum === 'color') {
    d.putObject(sTID('color'), sTID('RGBColor'), __mcp_fpRgbColor(opts.red, opts.green, opts.blue));
  }
  d.putEnumerated(sTID('mode'), sTID('blendMode'), sTID(__mcp_fpBlendModeStr(opts.blendMode)));
  d.putUnitDouble(sTID('opacity'), sTID('percentUnit'), __mcp_fpClampNum(opts.opacity, 0, 100));
  executeAction(sTID('fill'), d, DialogModes.NO);
  return layer.name;
}
`;

/**
 * Generate ExtendScript code with error handling
 */
export function generateExtendScript(code: string): string {
  return `
(function() {
  try {
    ${code}
  } catch (error) {
    return 'ERROR: ' + (error.message || String(error));
  }
})();
  `.trim();
}
