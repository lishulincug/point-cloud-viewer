/**
 * 点云导出工具
 * 支持 PCD、PLY、LAS 格式导出
 */

// 原始点云数据接口（保留原始坐标系和所有属性）
export interface OriginalPointData {
  // 原始 ROS 坐标系的顶点 (x, y, z)
  vertices: Float32Array;
  // 颜色 (r, g, b)，值范围 0-1
  colors: Float32Array | null;
  // 强度值（如果有）
  intensity: Float32Array | null;
  // 分类值（如果有）
  classification: Uint8Array | null;
  // 点数量
  count: number;
  // 原始文件格式
  format: 'pcd' | 'ply' | 'las' | 'unknown';
  // 原始文件名
  fileName: string;
}

/**
 * 导出为 PCD 格式（ASCII）
 */
export function exportToPCD(data: OriginalPointData): Blob {
  const { vertices, colors, intensity, count } = data;
  const hasColor = colors !== null;
  const hasIntensity = intensity !== null;

  // 构建 PCD 文件头
  let fields = 'x y z';
  let size = '4 4 4';
  let type = 'F F F';
  let countField = '1 1 1';

  if (hasColor) {
    fields += ' rgb';
    size += ' 4';
    type += ' U';
    countField += ' 1';
  }

  if (hasIntensity) {
    fields += ' intensity';
    size += ' 4';
    type += ' F';
    countField += ' 1';
  }

  let header = `# .PCD v0.7 - Point Cloud Data file format
VERSION 0.7
FIELDS ${fields}
SIZE ${size}
TYPE ${type}
COUNT ${countField}
WIDTH ${count}
HEIGHT 1
VIEWPOINT 0 0 0 1 0 0 0
POINTS ${count}
DATA ascii
`;

  // 构建点数据
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];

    let line = `${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`;

    if (hasColor && colors) {
      // 将 RGB 转换为打包的整数格式
      const r = Math.round(colors[i * 3] * 255);
      const g = Math.round(colors[i * 3 + 1] * 255);
      const b = Math.round(colors[i * 3 + 2] * 255);
      const rgb = (r << 16) | (g << 8) | b;
      line += ` ${rgb}`;
    }

    if (hasIntensity && intensity) {
      line += ` ${intensity[i].toFixed(2)}`;
    }

    lines.push(line);
  }

  const content = header + lines.join('\n');
  return new Blob([content], { type: 'text/plain' });
}

/**
 * 导出为 PLY 格式（ASCII）
 */
export function exportToPLY(data: OriginalPointData): Blob {
  const { vertices, colors, intensity, count } = data;
  const hasColor = colors !== null;
  const hasIntensity = intensity !== null;

  // 构建 PLY 文件头
  let header = `ply
format ascii 1.0
element vertex ${count}
property float x
property float y
property float z
`;

  if (hasColor) {
    header += `property uchar red
property uchar green
property uchar blue
`;
  }

  if (hasIntensity) {
    header += `property float intensity
`;
  }

  header += `end_header
`;

  // 构建点数据
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];

    let line = `${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`;

    if (hasColor && colors) {
      const r = Math.round(colors[i * 3] * 255);
      const g = Math.round(colors[i * 3 + 1] * 255);
      const b = Math.round(colors[i * 3 + 2] * 255);
      line += ` ${r} ${g} ${b}`;
    }

    if (hasIntensity && intensity) {
      line += ` ${intensity[i].toFixed(2)}`;
    }

    lines.push(line);
  }

  const content = header + lines.join('\n');
  return new Blob([content], { type: 'text/plain' });
}

/**
 * 根据原始格式导出点云
 */
export function exportPointCloud(
  data: OriginalPointData,
  format?: 'pcd' | 'ply'
): { blob: Blob; fileName: string } {
  const exportFormat = format || (data.format === 'las' ? 'pcd' : data.format) || 'pcd';
  
  // 生成文件名
  const baseName = data.fileName.replace(/\.(pcd|ply|las)$/i, '');
  const fileName = `${baseName}_filtered.${exportFormat}`;

  let blob: Blob;
  if (exportFormat === 'ply') {
    blob = exportToPLY(data);
  } else {
    blob = exportToPCD(data);
  }

  return { blob, fileName };
}

/**
 * 触发文件下载
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
