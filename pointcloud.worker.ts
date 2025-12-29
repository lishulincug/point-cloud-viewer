/**
 * 点云解析 Web Worker
 * 在后台线程处理大型点云文件的解析，避免阻塞主线程
 */

// 消息类型定义
interface WorkerMessage {
  type: 'parse_pcd' | 'parse_ply' | 'parse_las';
  data: ArrayBuffer;
  chunkSize?: number; // 可选：分块处理的大小
}

interface PCDData {
  vertices: Float32Array;  // Three.js 坐标系的顶点
  colors: Float32Array;
  count: number;
  originalVertices?: Float32Array;  // 原始 ROS 坐标系的顶点（用于导出）
}

interface ProgressMessage {
  type: 'progress';
  percent: number;
  message: string;
}

interface CompleteMessage {
  type: 'complete';
  data: PCDData;
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

// 解析 PCD 文件
function parsePCDFile(buffer: ArrayBuffer): PCDData {
  const decoder = new TextDecoder('utf-8');
  const data = new Uint8Array(buffer);
  
  // 查找 header 结束位置
  let headerEndIndex = 0;
  const headerText = decoder.decode(data.slice(0, Math.min(data.length, 4096)));
  const dataLine = headerText.indexOf('DATA');
  
  if (dataLine === -1) {
    throw new Error('无效的 PCD 文件格式');
  }
  
  // 解析 header
  const headerLines = headerText.slice(0, dataLine).split('\n');
  let pointCount = 0;
  let dataType = 'ascii';
  let fields: string[] = [];
  let sizes: number[] = [];
  let types: string[] = [];
  
  for (const line of headerLines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'POINTS') {
      pointCount = parseInt(parts[1]);
    } else if (parts[0] === 'FIELDS') {
      fields = parts.slice(1);
    } else if (parts[0] === 'SIZE') {
      sizes = parts.slice(1).map(Number);
    } else if (parts[0] === 'TYPE') {
      types = parts.slice(1);
    }
  }
  
  // 找到 DATA 行的结束
  const dataLineEnd = headerText.indexOf('\n', dataLine);
  dataType = headerText.slice(dataLine + 5, dataLineEnd).trim().toLowerCase();
  headerEndIndex = new TextEncoder().encode(headerText.slice(0, dataLineEnd + 1)).length;
  
  const vertices = new Float32Array(pointCount * 3);
  const originalVertices = new Float32Array(pointCount * 3);  // 原始坐标
  const colors = new Float32Array(pointCount * 3);
  
  // 检查是否有颜色字段
  const hasRGB = fields.includes('rgb') || fields.includes('rgba');
  const rgbIndex = fields.indexOf('rgb') !== -1 ? fields.indexOf('rgb') : fields.indexOf('rgba');
  
  if (dataType === 'binary') {
    // 二进制格式解析
    const dataView = new DataView(buffer, headerEndIndex);
    const pointSize = sizes.reduce((a, b) => a + b, 0);
    
    for (let i = 0; i < pointCount; i++) {
      const offset = i * pointSize;
      
      // 读取 x, y, z
      const x = dataView.getFloat32(offset, true);
      const y = dataView.getFloat32(offset + 4, true);
      const z = dataView.getFloat32(offset + 8, true);
      
      // 保存原始坐标（用于导出）
      originalVertices[i * 3] = x;
      originalVertices[i * 3 + 1] = y;
      originalVertices[i * 3 + 2] = z;
      
      // ROS 坐标系转换
      vertices[i * 3] = -y;
      vertices[i * 3 + 1] = z;
      vertices[i * 3 + 2] = -x;
      
      // 读取颜色
      if (hasRGB && rgbIndex !== -1) {
        let colorOffset = 0;
        for (let j = 0; j < rgbIndex; j++) {
          colorOffset += sizes[j];
        }
        const rgb = dataView.getUint32(offset + colorOffset, true);
        colors[i * 3] = ((rgb >> 16) & 0xff) / 255;
        colors[i * 3 + 1] = ((rgb >> 8) & 0xff) / 255;
        colors[i * 3 + 2] = (rgb & 0xff) / 255;
      } else {
        colors[i * 3] = 0.7;
        colors[i * 3 + 1] = 0.7;
        colors[i * 3 + 2] = 0.7;
      }
      
      // 每处理 10000 个点发送进度
      if (i % 10000 === 0) {
        const progress: ProgressMessage = {
          type: 'progress',
          percent: Math.round((i / pointCount) * 100),
          message: `解析中... ${i.toLocaleString()} / ${pointCount.toLocaleString()}`
        };
        self.postMessage(progress);
      }
    }
  } else {
    // ASCII 格式解析
    const textData = decoder.decode(data.slice(headerEndIndex));
    const lines = textData.trim().split('\n');
    
    for (let i = 0; i < Math.min(lines.length, pointCount); i++) {
      const parts = lines[i].trim().split(/\s+/);
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      const z = parseFloat(parts[2]);
      
      // 保存原始坐标（用于导出）
      originalVertices[i * 3] = x;
      originalVertices[i * 3 + 1] = y;
      originalVertices[i * 3 + 2] = z;
      
      vertices[i * 3] = -y;
      vertices[i * 3 + 1] = z;
      vertices[i * 3 + 2] = -x;
      
      colors[i * 3] = 0.7;
      colors[i * 3 + 1] = 0.7;
      colors[i * 3 + 2] = 0.7;
      
      if (i % 10000 === 0) {
        const progress: ProgressMessage = {
          type: 'progress',
          percent: Math.round((i / pointCount) * 100),
          message: `解析中... ${i.toLocaleString()} / ${pointCount.toLocaleString()}`
        };
        self.postMessage(progress);
      }
    }
  }
  
  return { vertices, colors, count: pointCount, originalVertices };
}

// 解析 LAS 文件
function parseLASFile(buffer: ArrayBuffer): PCDData {
  const dataView = new DataView(buffer);
  
  const signature = String.fromCharCode(
    dataView.getUint8(0),
    dataView.getUint8(1),
    dataView.getUint8(2),
    dataView.getUint8(3)
  );
  
  if (signature !== 'LASF') {
    throw new Error('无效的 LAS 文件格式');
  }
  
  const versionMajor = dataView.getUint8(24);
  const versionMinor = dataView.getUint8(25);
  
  const offsetToPointData = dataView.getUint32(96, true);
  const pointDataFormatId = dataView.getUint8(104);
  const pointDataRecordLength = dataView.getUint16(105, true);
  
  let numPoints: number;
  if (versionMajor === 1 && versionMinor < 4) {
    numPoints = dataView.getUint32(107, true);
  } else {
    numPoints = Number(dataView.getBigUint64(247, true));
  }
  
  const xScale = dataView.getFloat64(131, true);
  const yScale = dataView.getFloat64(139, true);
  const zScale = dataView.getFloat64(147, true);
  const xOffset = dataView.getFloat64(155, true);
  const yOffset = dataView.getFloat64(163, true);
  const zOffset = dataView.getFloat64(171, true);
  
  const vertices = new Float32Array(numPoints * 3);
  const originalVertices = new Float32Array(numPoints * 3);  // 原始坐标
  const colors = new Float32Array(numPoints * 3);
  
  const hasColor = [2, 3, 5, 7, 8, 10].includes(pointDataFormatId);
  const colorOffset = pointDataFormatId === 2 ? 20 : pointDataFormatId === 3 ? 28 : 0;
  
  for (let i = 0; i < numPoints; i++) {
    const offset = offsetToPointData + i * pointDataRecordLength;
    
    const xInt = dataView.getInt32(offset, true);
    const yInt = dataView.getInt32(offset + 4, true);
    const zInt = dataView.getInt32(offset + 8, true);
    
    const x = xInt * xScale + xOffset;
    const y = yInt * yScale + yOffset;
    const z = zInt * zScale + zOffset;
    
    // 保存原始坐标（用于导出）
    originalVertices[i * 3] = x;
    originalVertices[i * 3 + 1] = y;
    originalVertices[i * 3 + 2] = z;
    
    vertices[i * 3] = -y;
    vertices[i * 3 + 1] = z;
    vertices[i * 3 + 2] = -x;
    
    if (hasColor && colorOffset > 0) {
      colors[i * 3] = dataView.getUint16(offset + colorOffset, true) / 65535;
      colors[i * 3 + 1] = dataView.getUint16(offset + colorOffset + 2, true) / 65535;
      colors[i * 3 + 2] = dataView.getUint16(offset + colorOffset + 4, true) / 65535;
    } else {
      colors[i * 3] = 0.7;
      colors[i * 3 + 1] = 0.7;
      colors[i * 3 + 2] = 0.7;
    }
    
    // 每处理 50000 个点发送进度
    if (i % 50000 === 0) {
      const progress: ProgressMessage = {
        type: 'progress',
        percent: Math.round((i / numPoints) * 100),
        message: `解析中... ${i.toLocaleString()} / ${numPoints.toLocaleString()}`
      };
      self.postMessage(progress);
    }
  }
  
  return { vertices, colors, count: numPoints, originalVertices };
}

// Worker 消息处理
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data;
  
  try {
    let result: PCDData;
    
    switch (type) {
      case 'parse_pcd':
        result = parsePCDFile(data);
        break;
      case 'parse_las':
        result = parseLASFile(data);
        break;
      default:
        throw new Error(`不支持的解析类型: ${type}`);
    }
    
    // 发送完成消息（使用 Transferable 提升性能）
    const completeMsg: CompleteMessage = {
      type: 'complete',
      data: result
    };
    const transferList: ArrayBuffer[] = [result.vertices.buffer, result.colors.buffer];
    if (result.originalVertices) {
      transferList.push(result.originalVertices.buffer);
    }
    self.postMessage(completeMsg, { transfer: transferList });
    
  } catch (error) {
    const errorMsg: ErrorMessage = {
      type: 'error',
      error: (error as Error).message
    };
    self.postMessage(errorMsg);
  }
};

