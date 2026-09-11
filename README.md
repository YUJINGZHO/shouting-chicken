# 尖叫鸡 / Screaming Chicken · Squeak Lab

版本：2.0

一个可在浏览器中直接运行的电子尖叫鸡（Screaming Chicken）。按住鸡身会逐渐收缩，按压位置决定收缩位置；松开后，电子声学模型会根据压缩程度模拟橡胶尖叫鸡的进气、簧片振动、粗糙度和持续时间。

## 运行

直接打开 `index.html`，或在当前文件夹启动任意静态文件服务器后访问 `index.html`。

## 文件

- `index.html`：页面结构与中文文案
- `styles.css`：视觉样式、局部回弹与一屏响应式布局
- `squeeze-physics.js`：按压位置到鸡身各区域变形姿态的纯计算模块
- `app.js`：按压交互、首次尖叫庆祝与实时声音合成
- `tests/squeeze-physics.test.js`：局部变形算法的 Node 内置测试
- `PRODUCT.md`：产品说明和声音建模依据

## 交互

- 按住尖叫鸡：触点附近的身体部位逐渐压扁
- 按压位置：决定头、颈、身体、翅膀、尾巴或腿脚的局部变形
- 松开：根据压缩程度释放不同长度的尖叫
- 空格键 / Enter：键盘操作
- 页面支持中文 / English 切换，并会记住上次选择

## 测试

```powershell
node --test tests\squeeze-physics.test.js
node --check squeeze-physics.js
node --check app.js
```
