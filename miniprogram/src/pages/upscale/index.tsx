import { useCallback, useState } from 'react';
import { View, Text, Image, Canvas, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { chooseImage, saveToAlbum, formatSize, ChosenImage } from '../../utils/image';
import {
  MiniCanvas,
  canvasToTempFile,
  fitSize,
  getCanvas,
  loadCanvasImage,
  unsharpMaskPixels,
} from '../../utils/canvas';
import './index.scss';

/** 输入/输出最长边限制（小程序像素处理内存保护） */
const INPUT_MAX_DIM = 2048;
const OUTPUT_MAX_DIM = 2048;

const FACTORS = [2, 3, 4];

export default function Upscale() {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [factor, setFactor] = useState(2);
  const [result, setResult] = useState('');
  const [outSize, setOutSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (img: ChosenImage, f: number) => {
    setBusy(true);
    setResult('');
    Taro.showLoading({ title: '放大处理中…', mask: true });
    try {
      // 输入副本
      const inSize = fitSize(img.width, img.height, INPUT_MAX_DIM);
      // 目标输出尺寸（含内存保护收敛）
      const outFit = fitSize(inSize.w * f, inSize.h * f, OUTPUT_MAX_DIM);

      const canvasA = await getCanvas('ups-a');
      const canvasB = await getCanvas('ups-b');
      canvasA.width = inSize.w;
      canvasA.height = inSize.h;
      const actx = canvasA.getContext('2d');
      const bitmap = await loadCanvasImage(canvasA, img.filePath);
      actx.clearRect(0, 0, inSize.w, inSize.h);
      actx.drawImage(bitmap as unknown as never, 0, 0, inSize.w, inSize.h);

      // 分步 2x 放大（ping-pong 双画布，避免自绘自）
      let cur: MiniCanvas = canvasA;
      let next: MiniCanvas = canvasB;
      let curW = inSize.w;
      let curH = inSize.h;
      while (curW < outFit.w || curH < outFit.h) {
        const nextW = Math.min(outFit.w, curW * 2);
        const nextH = Math.min(outFit.h, curH * 2);
        next.width = nextW;
        next.height = nextH;
        const nctx = next.getContext('2d');
        nctx.imageSmoothingEnabled = true;
        nctx.clearRect(0, 0, nextW, nextH);
        nctx.drawImage(cur as unknown as never, 0, 0, nextW, nextH);
        const tmp = cur;
        cur = next;
        next = tmp;
        curW = nextW;
        curH = nextH;
      }

      // Unsharp Mask 锐化补偿插值模糊
      const fctx = cur.getContext('2d');
      const imageData = fctx.getImageData(0, 0, curW, curH);
      unsharpMaskPixels(imageData.data, curW, curH, f);
      fctx.putImageData(imageData, 0, 0);

      const path = await canvasToTempFile(cur, { fileType: 'jpg', quality: 0.95 });
      setResult(path);
      setOutSize({ w: curW, h: curH });
    } catch (err) {
      console.error(err);
      Taro.showToast({ title: '处理失败，请换小一些的图', icon: 'none' });
    } finally {
      Taro.hideLoading();
      setBusy(false);
    }
  }, []);

  const pickImage = async () => {
    try {
      const chosen = await chooseImage();
      if (!chosen) return;
      setImage(chosen);
      setResult('');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <View className="page">
      <View className="banner">
        <Text className="banner__title">高清无损放大</Text>
        <Text className="banner__desc">2~4 倍放大并锐化细节，模糊照片变清晰</Text>
      </View>

      {/* 选图 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">原始图片</Text>
          {image && (
            <Text className="card__action" onClick={pickImage}>
              重新选图
            </Text>
          )}
        </View>
        {image ? (
          <View>
            <Image className="pick__img" src={image.filePath} mode="aspectFit" />
            <Text className="pick__meta">
              {image.width}×{image.height} · {formatSize(image.size)}
            </Text>
          </View>
        ) : (
          <View className="pick pick--empty" onClick={pickImage}>
            <Text className="pick__plus">＋</Text>
            <Text className="pick__hint">点击选择图片</Text>
          </View>
        )}
      </View>

      {/* 倍数 */}
      {image && (
        <View className="card">
          <Text className="card__label">放大倍数</Text>
          <View className="row">
            {FACTORS.map((f) => (
              <View
                key={f}
                className={`chip ${factor === f ? 'chip--active' : ''}`}
                onClick={() => setFactor(f)}
              >
                <Text>{f} 倍</Text>
              </View>
            ))}
          </View>
          <Text className="card__tip">
            输出约 {Math.min(image.width * factor, OUTPUT_MAX_DIM)}×
            {Math.min(image.height * factor, OUTPUT_MAX_DIM)}px（超大图将等比收敛）
          </Text>
        </View>
      )}

      {/* 结果 */}
      {result && (
        <View className="card">
          <Text className="card__label">
            放大结果 {outSize.w}×{outSize.h}px
          </Text>
          <Image
            className="result-img"
            src={result}
            mode="aspectFit"
            onClick={() => Taro.previewImage({ current: result, urls: [result] })}
          />
          <Button className="result__save" onClick={() => saveToAlbum(result)}>
            保存到相册
          </Button>
        </View>
      )}

      <View className="footer">
        <Button
          className={`footer__btn ${busy ? 'footer__btn--disabled' : ''}`}
          disabled={busy}
          onClick={() => {
            if (!image) {
              pickImage();
            } else {
              run(image, factor);
            }
          }}
        >
          {busy ? '处理中…' : image ? `开始 ${factor} 倍放大` : '选择图片开始'}
        </Button>
      </View>
      <View className="footer-placeholder" />

      {/* 隐藏画布（ping-pong） */}
      <Canvas
        type="2d"
        id="ups-a"
        style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '10px', height: '10px' }}
      />
      <Canvas
        type="2d"
        id="ups-b"
        style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '10px', height: '10px' }}
      />
    </View>
  );
}
