const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 添加3D模型格式作为静态资源
config.resolver.assetExts.push('glb', 'vrm', 'gltf', 'bin', 'ktx2', 'meshopt', 'draco');

module.exports = config;