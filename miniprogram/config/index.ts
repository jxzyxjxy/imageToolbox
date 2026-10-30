// Taro 编译配置（微信小程序）
import { resolve } from 'path';

export default {
  alias: {
    '@': resolve(__dirname, '..', 'src'),
  },
  projectName: 'image-toolbox-miniprogram',
  date: '2026-10-19',
  // 设计稿 750，代码中 1px = 2rpx
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    375: 2,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {},
  copy: {
    // tabBar 图标为静态二进制资源，不经 webpack 处理，直接拷入 dist
    // （app.config.ts 中 iconPath 引用 'assets/tabbar/xxx.png'）
    patterns: [{ from: 'src/assets/tabbar/', to: 'dist/assets/tabbar/' }],
    options: {},
  },
  framework: 'react',
  compiler: 'webpack5',
  cache: {
    enable: false,
  },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
  h5: {},
};
