export default defineAppConfig({
  pages: [
    'pages/index/index',
    // 注意：注册路径必须与源码路径完全一致（源码在 pages/video/index/index.tsx），
    // 注册成 pages/video/index 会导致 Taro 产物劈叉（js 平铺、wxml 嵌套），真机白屏
    'pages/video/index/index',
    'pages/similar/index',
    'pages/compress/index',
    'pages/restore/index',
    'pages/id-photo/index',
    'pages/remove-bg/index',
    'pages/remove-watermark/index',
    'pages/smart-eraser/index',
    'pages/upscale/index',
    'pages/icon-splitter/index',
    'pages/video/compress/index',
    'pages/video/parse/index',
  ],
  tabBar: {
    // 自定义 tabBar：实测该环境下官方 tabBar 图标文件（png/jpg 各种编码形态）全部裂图——
    // 「从代码包加载图标文件」这条机制本身不可用，故用组件自绘 + base64 内联图标，
    // 从机制上消除文件加载环节；切页与高亮同步均走事件总线（页面上下文执行，带全路径兜底）。
    // list 的 iconPath 仍需合法（页面注册依赖 list），jpg 文件保留在包内。
    custom: true,
    color: '#94a3b8',
    selectedColor: '#6366f1',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '图片工具',
        iconPath: 'assets/tabbar/pic-off.jpg',
        selectedIconPath: 'assets/tabbar/pic-on.jpg',
      },
      {
        pagePath: 'pages/video/index/index',
        text: '视频工具',
        iconPath: 'assets/tabbar/video-off.jpg',
        selectedIconPath: 'assets/tabbar/video-on.jpg',
      },
    ],
  },
  // 注意：不要开启 lazyCodeLoading: 'requiredComponents'——
  // 已知问题：开启后部分基础库版本 tabBar 图标裂图/不显示，且 tab 页首次打开需现场注入组件导致首切明显变慢。
  // 全量注入的体积代价可接受（主包 < 2MB），换取 tabBar 图标稳定显示与 tab 切换瞬时响应。
  window: {
    backgroundTextStyle: 'light',
    backgroundColor: '#f5f6fa',
    navigationBarBackgroundColor: '#6366f1',
    navigationBarTitleText: '青芽影图',
    navigationBarTextStyle: 'white',
  },
});
