/**
 * 点云可视化组件
 * 完全按照原始 pcd-viewer.js 转换为 TypeScript
 * 支持 URL 传参：?url=xxx.pcd 或 ?file=xxx.pcd
 */
import React, { useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

import './index.scss';
import type { OriginalPointData } from './export';
import { exportPointCloud, downloadBlob } from './export';

// 类型定义
interface PCDData {
  vertices: Float32Array;  // Three.js 坐标系的顶点
  colors: Float32Array;
  originalColors: Float32Array;
  count: number;
  // 原始 ROS 坐标系的顶点（用于导出）
  originalVertices?: Float32Array;
}

interface Waypoint {
  id: number;
  name: string;
  position: THREE.Vector3;
  originalPosition: THREE.Vector3;
  quaternion: THREE.Quaternion;
  mesh: THREE.Mesh;
  label: THREE.Sprite;
}

interface WaypointConnection {
  from: number;
  to: number;
  line: THREE.Line;
}

// PCDViewer 类
class PCDViewer {
  scene: THREE.Scene | null = null;
  camera: THREE.PerspectiveCamera | null = null;
  orthoCamera: THREE.OrthographicCamera | null = null;
  activeCamera: THREE.Camera | null = null;
  isOrthoView: boolean = false;
  renderer: THREE.WebGLRenderer | null = null;
  controls: OrbitControls | null = null;
  pointCloud: THREE.Points | null = null;
  currentPCDData: PCDData | null = null;
  colorMode: string = 'height';
  minHeight: number | null = null;
  maxHeight: number | null = null;
  heightFilterMin: number = 0;
  heightFilterMax: number = 1;

  // 原始点云数据（用于导出，保留原始坐标系和属性）
  originalPointData: OriginalPointData | null = null;
  currentFileName: string = 'pointcloud';
  currentFormat: 'pcd' | 'ply' | 'las' | 'unknown' = 'unknown';

  pcdLoader: PCDLoader = new PCDLoader();
  plyLoader: PLYLoader = new PLYLoader();

  waypointMode: boolean = false;
  waypoints: Waypoint[] = [];
  waypointConnections: WaypointConnection[] = [];
  waypointGroup: THREE.Group = new THREE.Group();
  connectionGroup: THREE.Group = new THREE.Group();
  raycaster: THREE.Raycaster = new THREE.Raycaster();
  mouse: THREE.Vector2 = new THREE.Vector2();

  defaultCameraPosition = { x: 25, y: 25, z: -25 };

  container: HTMLDivElement;
  onPointCountChange: (count: number) => void;
  onLoadStatusChange: (status: string) => void;
  onWaypointCountChange: (count: number) => void;

  constructor(
    container: HTMLDivElement,
    onPointCountChange: (count: number) => void,
    onLoadStatusChange: (status: string) => void,
    onWaypointCountChange: (count: number) => void
  ) {
    this.container = container;
    this.onPointCountChange = onPointCountChange;
    this.onLoadStatusChange = onLoadStatusChange;
    this.onWaypointCountChange = onWaypointCountChange;
    this.init();
  }

  init() {
    // 创建场景
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // 创建透视相机
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      10000
    );
    this.camera.position.set(
      this.defaultCameraPosition.x,
      this.defaultCameraPosition.y,
      this.defaultCameraPosition.z
    );

    // 创建正交相机
    const aspect = this.container.clientWidth / this.container.clientHeight;
    const frustumSize = 100;
    this.orthoCamera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      10000
    );

    // 默认使用透视相机
    this.activeCamera = this.camera;

    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // 创建控制器
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 1000;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = THREE.TOUCH.PAN;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;

    // 添加光源
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 100);
    this.scene.add(directionalLight);

    // 创建 ROS 坐标系辅助器
    this.createROSAxesHelper();

    // 添加路点组到场景
    this.scene.add(this.waypointGroup);
    this.scene.add(this.connectionGroup);

    // 动画循环
    this.animate();
  }

  createROSAxesHelper() {
    const axisLength = 5;
    const axisGroup = new THREE.Group();

    // ROS X轴 (红色, 前方) → Three.js Z轴
    const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, axisLength),
    ]);
    const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
    axisGroup.add(xAxis);

    // ROS Y轴 (绿色, 左) → Three.js -X轴
    const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-axisLength, 0, 0),
    ]);
    const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
    axisGroup.add(yAxis);

    // ROS Z轴 (蓝色, 上) → Three.js Y轴
    const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, axisLength, 0),
    ]);
    const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
    const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);
    axisGroup.add(zAxis);

    this.scene!.add(axisGroup);
  }

  onWindowResize() {
    if (!this.camera || !this.renderer || !this.orthoCamera) return;
    const aspect = this.container.clientWidth / this.container.clientHeight;

    // 更新透视相机
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    // 更新正交相机
    const frustumSize = this.orthoCamera.top * 2;
    this.orthoCamera.left = (frustumSize * aspect) / -2;
    this.orthoCamera.right = (frustumSize * aspect) / 2;
    this.orthoCamera.updateProjectionMatrix();

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    this.controls?.update();
    if (this.renderer && this.scene && this.activeCamera) {
      this.renderer.render(this.scene, this.activeCamera);
    }
  };

  loadPCDFile(file: File) {
    this.onLoadStatusChange('加载中...');
    this.currentFileName = file.name;
    this.currentFormat = 'pcd';

    const url = URL.createObjectURL(file);

    this.pcdLoader.load(
      url,
      (points) => {
        URL.revokeObjectURL(url);
        const pcdData = this.extractPCDData(points);
        this.saveOriginalData(pcdData, 'pcd', file.name);
        this.createPointCloud(pcdData);
        this.onLoadStatusChange('加载完成');
        console.log('Loaded points:', pcdData.count);
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          this.onLoadStatusChange(`加载中... ${percent}%`);
        }
      },
      (error) => {
        URL.revokeObjectURL(url);
        console.error('PCD loading error:', error);
        this.onLoadStatusChange('错误: ' + (error as Error).message);
      }
    );
  }

  loadPLYFile(file: File) {
    this.onLoadStatusChange('加载中...');
    this.currentFileName = file.name;
    this.currentFormat = 'ply';

    const url = URL.createObjectURL(file);

    this.plyLoader.load(
      url,
      (geometry) => {
        URL.revokeObjectURL(url);
        const pcdData = this.extractGeometryData(geometry);
        this.saveOriginalData(pcdData, 'ply', file.name);
        this.createPointCloud(pcdData);
        this.onLoadStatusChange('加载完成');
        console.log('Loaded points:', pcdData.count);
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          this.onLoadStatusChange(`加载中... ${percent}%`);
        }
      },
      (error) => {
        URL.revokeObjectURL(url);
        console.error('PLY loading error:', error);
        this.onLoadStatusChange('错误: ' + (error as Error).message);
      }
    );
  }

  async loadLASFile(file: File) {
    this.onLoadStatusChange('加载中...');
    this.currentFileName = file.name;
    this.currentFormat = 'las';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pcdData = this.parseLASFile(arrayBuffer);
      this.saveOriginalData(pcdData, 'las', file.name);
      this.createPointCloud(pcdData);
      this.onLoadStatusChange('加载完成');
      console.log('Loaded points:', pcdData.count);
    } catch (error) {
      console.error('LAS loading error:', error);
      this.onLoadStatusChange('错误: ' + (error as Error).message);
    }
  }

  // 加载取消控制器
  private abortController: AbortController | null = null;
  private worker: Worker | null = null;

  // 取消当前加载
  cancelLoad() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.onLoadStatusChange('已取消');
  }

  // 从 URL 加载点云文件（优化版：流式下载 + Worker 解析）
  async loadFromURL(url: string, useWorker: boolean = true) {
    // 取消之前的加载
    this.cancelLoad();
    
    this.onLoadStatusChange('准备下载...');
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // 获取文件扩展名和文件名
    const ext = url.toLowerCase().split('.').pop()?.split('?')[0] || '';
    const fileName = url.split('/').pop()?.split('?')[0] || 'pointcloud.' + ext;
    this.currentFileName = fileName;
    this.currentFormat = ext as 'pcd' | 'ply' | 'las' | 'unknown';
    
    // PLY 格式继续使用原有 loader（PLYLoader 有优化）
    if (ext === 'ply') {
      this.plyLoader.load(
        url,
        (geometry) => {
          const pcdData = this.extractGeometryData(geometry);
          this.saveOriginalData(pcdData, 'ply', fileName);
          this.createPointCloud(pcdData);
          this.onLoadStatusChange('加载完成');
          console.log('Loaded points from URL:', pcdData.count);
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            this.onLoadStatusChange(`下载中... ${percent}%`);
          }
        },
        (error) => {
          console.error('PLY loading error from URL:', error);
          this.onLoadStatusChange('错误: 无法从URL加载文件');
        }
      );
      return;
    }

    try {
      // 使用 fetch 进行流式下载，支持进度显示
      const response = await fetch(url, { signal });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      
      // 流式读取数据
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const chunks: Uint8Array[] = [];
      let received = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        received += value.length;
        
        // 更新下载进度
        if (total > 0) {
          const percent = Math.round((received / total) * 100);
          const sizeMB = (received / 1024 / 1024).toFixed(1);
          const totalMB = (total / 1024 / 1024).toFixed(1);
          this.onLoadStatusChange(`下载中... ${percent}% (${sizeMB}/${totalMB} MB)`);
        } else {
          const sizeMB = (received / 1024 / 1024).toFixed(1);
          this.onLoadStatusChange(`下载中... ${sizeMB} MB`);
        }
      }
      
      // 合并数据块
      const arrayBuffer = this.concatenateArrayBuffers(chunks);
      this.onLoadStatusChange('下载完成，解析中...');
      
      // 根据文件类型和大小决定是否使用 Worker
      const fileSizeMB = arrayBuffer.byteLength / 1024 / 1024;
      const shouldUseWorker = useWorker && fileSizeMB > 5; // 大于 5MB 使用 Worker
      
      if (shouldUseWorker && (ext === 'pcd' || ext === 'las')) {
        await this.parseWithWorker(arrayBuffer, ext);
      } else {
        // 小文件直接在主线程解析
        if (ext === 'pcd') {
          // 使用 PCDLoader 解析 ArrayBuffer
          const blob = new Blob([arrayBuffer]);
          const blobUrl = URL.createObjectURL(blob);
          this.pcdLoader.load(
            blobUrl,
            (points) => {
              URL.revokeObjectURL(blobUrl);
              const pcdData = this.extractPCDData(points);
              this.saveOriginalData(pcdData, 'pcd', fileName);
              this.createPointCloud(pcdData);
              this.onLoadStatusChange('加载完成');
              console.log('Loaded points from URL:', pcdData.count);
            },
            undefined,
            (error) => {
              URL.revokeObjectURL(blobUrl);
              console.error('PCD parsing error:', error);
              this.onLoadStatusChange('错误: 解析失败');
            }
          );
        } else if (ext === 'las') {
          const pcdData = this.parseLASFile(arrayBuffer);
          this.saveOriginalData(pcdData, 'las', fileName);
          this.createPointCloud(pcdData);
          this.onLoadStatusChange('加载完成');
        } else {
          this.onLoadStatusChange('错误: 不支持的文件格式');
        }
      }
      
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('加载已取消');
        return;
      }
      console.error('加载错误:', error);
      this.onLoadStatusChange('错误: ' + (error as Error).message);
    }
  }

  // 合并 ArrayBuffer 数组
  private concatenateArrayBuffers(chunks: Uint8Array[]): ArrayBuffer {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer;
  }

  // 使用 Worker 解析大文件
  private parseWithWorker(buffer: ArrayBuffer, ext: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 创建 Worker
      this.worker = new Worker(
        new URL('./pointcloud.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event) => {
        const message = event.data;
        
        if (message.type === 'progress') {
          this.onLoadStatusChange(message.message);
        } else if (message.type === 'complete') {
          const pcdData: PCDData = {
            vertices: message.data.vertices,
            colors: message.data.colors,
            originalColors: new Float32Array(message.data.colors),
            count: message.data.count,
            originalVertices: message.data.originalVertices
          };
          // 保存原始数据用于导出
          this.saveOriginalData(pcdData, ext as 'pcd' | 'ply' | 'las', this.currentFileName);
          this.createPointCloud(pcdData);
          this.onLoadStatusChange(`加载完成 (${pcdData.count.toLocaleString()} 点)`);
          this.worker?.terminate();
          this.worker = null;
          resolve();
        } else if (message.type === 'error') {
          this.onLoadStatusChange('错误: ' + message.error);
          this.worker?.terminate();
          this.worker = null;
          reject(new Error(message.error));
        }
      };

      this.worker.onerror = (error) => {
        console.error('Worker error:', error);
        this.onLoadStatusChange('解析错误');
        this.worker?.terminate();
        this.worker = null;
        reject(error);
      };

      // 发送数据到 Worker（使用 Transferable 提高性能）
      const type = ext === 'pcd' ? 'parse_pcd' : 'parse_las';
      this.worker.postMessage({ type, data: buffer }, [buffer]);
    });
  }

  // 兼容旧方法（使用原有 loader）
  loadFromURLLegacy(url: string) {
    this.onLoadStatusChange('从URL加载中...');

    // 获取文件扩展名
    const ext = url.toLowerCase().split('.').pop()?.split('?')[0] || '';

    if (ext === 'pcd') {
      this.pcdLoader.load(
        url,
        (points) => {
          const pcdData = this.extractPCDData(points);
          this.createPointCloud(pcdData);
          this.onLoadStatusChange('加载完成');
          console.log('Loaded points from URL:', pcdData.count);
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            this.onLoadStatusChange(`加载中... ${percent}%`);
          }
        },
        (error) => {
          console.error('PCD loading error from URL:', error);
          this.onLoadStatusChange('错误: 无法从URL加载文件');
        }
      );
    } else if (ext === 'ply') {
      this.plyLoader.load(
        url,
        (geometry) => {
          const pcdData = this.extractGeometryData(geometry);
          this.createPointCloud(pcdData);
          this.onLoadStatusChange('加载完成');
          console.log('Loaded points from URL:', pcdData.count);
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            this.onLoadStatusChange(`加载中... ${percent}%`);
          }
        },
        (error) => {
          console.error('PLY loading error from URL:', error);
          this.onLoadStatusChange('错误: 无法从URL加载文件');
        }
      );
    } else if (ext === 'las') {
      this.loadLASFromURL(url);
    } else {
      this.onLoadStatusChange('错误: 不支持的文件格式');
    }
  }

  // 从 URL 加载 LAS 文件
  async loadLASFromURL(url: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const pcdData = this.parseLASFile(arrayBuffer);
      this.createPointCloud(pcdData);
      this.onLoadStatusChange('加载完成');
      console.log('Loaded LAS points from URL:', pcdData.count);
    } catch (error) {
      console.error('LAS loading error from URL:', error);
      this.onLoadStatusChange('错误: ' + (error as Error).message);
    }
  }

  parseLASFile(arrayBuffer: ArrayBuffer): PCDData {
    const dataView = new DataView(arrayBuffer);

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
    console.log(`LAS 版本: ${versionMajor}.${versionMinor}`);

    const offsetToPointData = dataView.getUint32(96, true);
    const pointDataFormatId = dataView.getUint8(104);
    const pointDataRecordLength = dataView.getUint16(105, true);

    let numPoints: number;
    if (versionMajor === 1 && versionMinor < 4) {
      numPoints = dataView.getUint32(107, true);
    } else {
      numPoints = Number(dataView.getBigUint64(247, true));
    }

    console.log(`点数量: ${numPoints}, 格式: ${pointDataFormatId}`);

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
        const r = dataView.getUint16(offset + colorOffset, true) / 65535;
        const g = dataView.getUint16(offset + colorOffset + 2, true) / 65535;
        const b = dataView.getUint16(offset + colorOffset + 4, true) / 65535;
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      } else {
        colors[i * 3] = 0.7;
        colors[i * 3 + 1] = 0.7;
        colors[i * 3 + 2] = 0.7;
      }
    }

    return {
      vertices,
      colors,
      originalColors: new Float32Array(colors),
      count: numPoints,
      originalVertices,
    };
  }

  extractPCDData(points: THREE.Points): PCDData {
    const geometry = points.geometry;
    const positions = geometry.attributes.position.array as Float32Array;
    const vertexCount = positions.length / 3;

    let colors: Float32Array;
    if (geometry.attributes.color) {
      colors = new Float32Array(geometry.attributes.color.array);
    } else {
      colors = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        colors[i * 3] = 0.7;
        colors[i * 3 + 1] = 0.7;
        colors[i * 3 + 2] = 0.7;
      }
    }

    // 保存原始 ROS 坐标系的顶点（用于导出）
    const originalVertices = new Float32Array(positions);

    // ROS坐标系转换到Three.js坐标系
    const vertices = new Float32Array(positions.length);
    for (let i = 0; i < vertexCount; i++) {
      const x_ros = positions[i * 3];
      const y_ros = positions[i * 3 + 1];
      const z_ros = positions[i * 3 + 2];

      vertices[i * 3] = -y_ros;
      vertices[i * 3 + 1] = z_ros;
      vertices[i * 3 + 2] = -x_ros;
    }

    console.log('Extracted vertices:', vertexCount);

    return {
      vertices,
      colors,
      count: vertexCount,
      originalColors: new Float32Array(colors),
      originalVertices,
    };
  }

  extractGeometryData(geometry: THREE.BufferGeometry): PCDData {
    const positions = geometry.attributes.position.array as Float32Array;
    const vertexCount = positions.length / 3;

    let colors: Float32Array;
    if (geometry.attributes.color) {
      colors = new Float32Array(geometry.attributes.color.array);
    } else {
      colors = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        colors[i * 3] = 0.7;
        colors[i * 3 + 1] = 0.7;
        colors[i * 3 + 2] = 0.7;
      }
    }

    // 保存原始 ROS 坐标系的顶点（用于导出）
    const originalVertices = new Float32Array(positions);

    const vertices = new Float32Array(positions.length);
    for (let i = 0; i < vertexCount; i++) {
      const x_ros = positions[i * 3];
      const y_ros = positions[i * 3 + 1];
      const z_ros = positions[i * 3 + 2];

      vertices[i * 3] = -y_ros;
      vertices[i * 3 + 1] = z_ros;
      vertices[i * 3 + 2] = -x_ros;
    }

    return {
      vertices,
      colors,
      count: vertexCount,
      originalColors: new Float32Array(colors),
      originalVertices,
    };
  }

  // 是否启用渐进式渲染
  progressiveRenderEnabled: boolean = true;
  // 点云降采样级别（1 = 不降采样，2 = 每隔1个点，以此类推）
  downsampleLevel: number = 1;

  createPointCloud(pcdData: PCDData, adjustCamera: boolean = true) {
    // 删除现有点云
    if (this.pointCloud && this.scene) {
      this.scene.remove(this.pointCloud);
      this.pointCloud.geometry.dispose();
      (this.pointCloud.material as THREE.Material).dispose();
    }

    // 保存当前数据
    this.currentPCDData = pcdData;

    // 计算高度范围
    this.calculateHeightRange(pcdData);

    // 应用高度过滤器
    const filteredData = this.applyHeightFilter(pcdData);

    // 应用降采样（如果设置）
    const renderData = this.downsampleLevel > 1 
      ? this.downsamplePointCloud(filteredData, this.downsampleLevel)
      : filteredData;

    // 计算颜色
    const colors = this.calculateColors(renderData);

    // 创建几何体
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(renderData.vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // 创建优化的材质
    const material = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      sizeAttenuation: true,
      // 优化：禁用深度写入可提升性能
      // depthWrite: false,
    });

    // 创建点云
    this.pointCloud = new THREE.Points(geometry, material);
    
    // 优化：设置 frustum culling
    this.pointCloud.frustumCulled = true;
    
    this.scene!.add(this.pointCloud);

    // 计算包围盒并调整相机（仅在 adjustCamera 为 true 时）
    geometry.computeBoundingBox();
    if (adjustCamera) {
      const bbox = geometry.boundingBox;
      if (bbox && this.camera && this.controls) {
        const center = new THREE.Vector3();
        bbox.getCenter(center);

        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);

        const distance = maxDim * 0.4;
        this.camera.position.set(center.x + distance, center.y + distance, center.z + distance);
        this.controls.target.copy(center);
        this.controls.update();
      }
    }

    // 显示实际渲染的点数
    const actualCount = renderData.count;
    const totalCount = filteredData.count;
    if (this.downsampleLevel > 1) {
      this.onPointCountChange(actualCount);
      console.log(`渲染 ${actualCount.toLocaleString()} / ${totalCount.toLocaleString()} 点 (降采样 ${this.downsampleLevel}x)`);
    } else {
      this.onPointCountChange(actualCount);
    }
  }

  // 点云降采样
  private downsamplePointCloud(pcdData: PCDData, level: number): PCDData {
    if (level <= 1) return pcdData;
    
    const originalCount = pcdData.count;
    const newCount = Math.ceil(originalCount / level);
    
    const vertices = new Float32Array(newCount * 3);
    const colors = new Float32Array(newCount * 3);
    const originalColors = new Float32Array(newCount * 3);
    
    for (let i = 0, j = 0; i < originalCount && j < newCount; i += level, j++) {
      vertices[j * 3] = pcdData.vertices[i * 3];
      vertices[j * 3 + 1] = pcdData.vertices[i * 3 + 1];
      vertices[j * 3 + 2] = pcdData.vertices[i * 3 + 2];
      
      colors[j * 3] = pcdData.colors[i * 3];
      colors[j * 3 + 1] = pcdData.colors[i * 3 + 1];
      colors[j * 3 + 2] = pcdData.colors[i * 3 + 2];
      
      originalColors[j * 3] = pcdData.originalColors[i * 3];
      originalColors[j * 3 + 1] = pcdData.originalColors[i * 3 + 1];
      originalColors[j * 3 + 2] = pcdData.originalColors[i * 3 + 2];
    }
    
    return { vertices, colors, originalColors, count: newCount };
  }

  // 设置降采样级别
  setDownsampleLevel(level: number) {
    this.downsampleLevel = Math.max(1, level);
    if (this.currentPCDData) {
      this.createPointCloud(this.currentPCDData, false);  // 不调整相机
    }
  }

  resetCamera() {
    if (!this.camera || !this.controls) return;

    // 切换回透视视图
    if (this.isOrthoView) {
      this.setPerspectiveView();
    }

    // 如果有点云，根据点云包围盒计算合适的相机位置
    if (this.pointCloud && this.pointCloud.geometry.boundingBox) {
      const bbox = this.pointCloud.geometry.boundingBox;
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      const size = new THREE.Vector3();
      bbox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);

      // 计算合适的观察距离
      const distance = maxDim * 0.6;

      // 从右上后方观察（ROS坐标系视角）
      this.camera.position.set(
        center.x + distance,
        center.y + distance,
        center.z + distance
      );
      this.controls.target.copy(center);
    } else {
      // 没有点云时使用默认位置
      this.camera.position.set(
        this.defaultCameraPosition.x,
        this.defaultCameraPosition.y,
        this.defaultCameraPosition.z
      );
      this.controls.target.set(0, 0, 0);
    }

    this.controls.update();
  }

  // 设置正交俯视视图
  setTopView() {
    if (!this.orthoCamera || !this.controls || !this.renderer) return;

    let center = new THREE.Vector3(0, 0, 0);
    let frustumSize = 100;

    // 如果有点云，根据点云包围盒设置视图
    if (this.pointCloud && this.pointCloud.geometry.boundingBox) {
      const bbox = this.pointCloud.geometry.boundingBox;
      bbox.getCenter(center);

      const size = new THREE.Vector3();
      bbox.getSize(size);

      // 计算包含整个点云的视野大小
      frustumSize = Math.max(size.x, size.z) * 1.2;
    }

    // 更新正交相机参数
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.orthoCamera.left = (frustumSize * aspect) / -2;
    this.orthoCamera.right = (frustumSize * aspect) / 2;
    this.orthoCamera.top = frustumSize / 2;
    this.orthoCamera.bottom = frustumSize / -2;
    this.orthoCamera.updateProjectionMatrix();

    // 设置正交相机位置（从正上方俯视）
    this.orthoCamera.position.set(center.x, center.y + 1000, center.z);
    this.orthoCamera.lookAt(center);

    // 切换到正交相机
    this.activeCamera = this.orthoCamera;
    this.isOrthoView = true;

    // 更新控制器
    this.controls.object = this.orthoCamera;
    this.controls.target.copy(center);
    this.controls.enableRotate = false; // 禁用旋转，只允许平移和缩放
    this.controls.update();

    console.log('Switched to orthographic top view');
  }

  // 恢复透视视图
  setPerspectiveView() {
    if (!this.camera || !this.controls) return;

    // 切换回透视相机
    this.activeCamera = this.camera;
    this.isOrthoView = false;

    // 更新控制器
    this.controls.object = this.camera;
    this.controls.enableRotate = true; // 恢复旋转
    this.controls.update();

    console.log('Switched to perspective view');
  }

  calculateColors(pcdData: PCDData): Float32Array {
    if (this.colorMode === 'default') {
      return pcdData.originalColors;
    }

    const vertices = pcdData.vertices;
    const colors = new Float32Array(vertices.length);
    const vertexCount = vertices.length / 3;

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
      const z = vertices[i * 3 + 1];
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    console.log(`Height range: ${minZ.toFixed(2)} to ${maxZ.toFixed(2)}`);

    for (let i = 0; i < vertexCount; i++) {
      const z = vertices[i * 3 + 1];
      const normalizedHeight = (z - minZ) / (maxZ - minZ);

      let r: number, g: number, b: number;

      switch (this.colorMode) {
        case 'height':
          if (normalizedHeight < 0.5) {
            r = 0;
            g = normalizedHeight * 2;
            b = 1 - normalizedHeight * 2;
          } else {
            r = (normalizedHeight - 0.5) * 2;
            g = 1 - (normalizedHeight - 0.5) * 2;
            b = 0;
          }
          break;

        case 'rainbow':
          const hue = normalizedHeight * 300;
          const rgb = this.hslToRgb(hue / 360, 1, 0.5);
          r = rgb[0];
          g = rgb[1];
          b = rgb[2];
          break;

        case 'heat':
          if (normalizedHeight < 0.33) {
            r = normalizedHeight * 3;
            g = 0;
            b = 0;
          } else if (normalizedHeight < 0.66) {
            r = 1;
            g = (normalizedHeight - 0.33) * 3;
            b = 0;
          } else {
            r = 1;
            g = 1;
            b = (normalizedHeight - 0.66) * 3;
          }
          break;

        default:
          r = g = b = 0.7;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    return colors;
  }

  hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r: number, g: number, b: number;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number): number => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return [r, g, b];
  }

  calculateHeightRange(pcdData: PCDData) {
    const vertices = pcdData.vertices;
    const vertexCount = vertices.length / 3;

    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
      const z = vertices[i * 3 + 1];
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    this.minHeight = minZ;
    this.maxHeight = maxZ;
  }

  applyHeightFilter(pcdData: PCDData): PCDData {
    const vertices = pcdData.vertices;
    const colors = pcdData.originalColors;
    const vertexCount = vertices.length / 3;

    const filteredVertices: number[] = [];
    const filteredColors: number[] = [];

    const actualMinHeight =
      this.minHeight! + (this.maxHeight! - this.minHeight!) * this.heightFilterMin;
    const actualMaxHeight =
      this.minHeight! + (this.maxHeight! - this.minHeight!) * this.heightFilterMax;

    for (let i = 0; i < vertexCount; i++) {
      const x = vertices[i * 3];
      const y = vertices[i * 3 + 1];
      const z = vertices[i * 3 + 2];

      if (y >= actualMinHeight && y <= actualMaxHeight) {
        filteredVertices.push(x, y, z);
        filteredColors.push(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
      }
    }

    return {
      vertices: new Float32Array(filteredVertices),
      colors: new Float32Array(filteredColors),
      originalColors: new Float32Array(filteredColors),
      count: filteredVertices.length / 3,
    };
  }

  setHeightFilter(minNormalized: number, maxNormalized: number) {
    this.heightFilterMin = Math.max(0, Math.min(1, minNormalized));
    this.heightFilterMax = Math.max(0, Math.min(1, maxNormalized));

    if (this.heightFilterMin > this.heightFilterMax) {
      this.heightFilterMin = this.heightFilterMax;
    }

    if (this.currentPCDData) {
      this.createPointCloud(this.currentPCDData, false);  // 不调整相机
    }
  }

  resetHeightFilter() {
    this.heightFilterMin = 0;
    this.heightFilterMax = 1;

    if (this.currentPCDData) {
      this.createPointCloud(this.currentPCDData, false);  // 不调整相机
    }
  }

  setColorMode(mode: string) {
    this.colorMode = mode;
    if (this.currentPCDData && this.pointCloud) {
      const filteredData = this.applyHeightFilter(this.currentPCDData);
      const colors = this.calculateColors(filteredData);
      this.pointCloud.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.pointCloud.geometry.attributes.color.needsUpdate = true;
    }
  }

  setPointSize(size: number) {
    if (this.pointCloud) {
      (this.pointCloud.material as THREE.PointsMaterial).size = size;
      (this.pointCloud.material as THREE.PointsMaterial).needsUpdate = true;
    }
  }

  // 保存原始点云数据（用于导出）
  saveOriginalData(pcdData: PCDData, format: 'pcd' | 'ply' | 'las', fileName: string) {
    this.currentFormat = format;
    this.currentFileName = fileName;
    
    // 使用原始坐标系的顶点（如果有的话）
    const vertices = pcdData.originalVertices || pcdData.vertices;
    
    this.originalPointData = {
      vertices: new Float32Array(vertices),
      colors: pcdData.originalColors ? new Float32Array(pcdData.originalColors) : null,
      intensity: null,  // 如果有强度数据可以在这里保存
      classification: null,  // 如果有分类数据可以在这里保存
      count: pcdData.count,
      format: format,
      fileName: fileName,
    };
  }

  // 导出当前过滤后的点云数据
  exportFilteredPointCloud(exportFormat?: 'pcd' | 'ply') {
    if (!this.originalPointData || !this.currentPCDData) {
      console.warn('没有可导出的点云数据');
      return;
    }

    // 获取当前过滤后的数据
    const filteredData = this.applyHeightFilter(this.currentPCDData);
    
    // 计算过滤后的点对应的原始数据索引
    // 由于 applyHeightFilter 是基于 Three.js 坐标系的高度过滤，
    // 我们需要重新从原始数据中应用相同的过滤逻辑
    const originalVertices = this.originalPointData.vertices;
    const originalColors = this.originalPointData.colors;
    const originalCount = this.originalPointData.count;
    
    // 原始数据的高度过滤（使用 ROS 坐标系的 z 轴，对应 Three.js 的 y 轴）
    const filteredOriginalVertices: number[] = [];
    const filteredOriginalColors: number[] = [];
    
    // 计算 Three.js 坐标系的高度范围
    if (this.minHeight === null || this.maxHeight === null) {
      console.warn('未计算高度范围');
      return;
    }
    
    const actualMinHeight = this.minHeight + (this.maxHeight - this.minHeight) * this.heightFilterMin;
    const actualMaxHeight = this.minHeight + (this.maxHeight - this.minHeight) * this.heightFilterMax;
    
    for (let i = 0; i < originalCount; i++) {
      // 原始 ROS 坐标系：x_ros, y_ros, z_ros
      // Three.js 坐标系转换：x = -y_ros, y = z_ros, z = -x_ros
      // 所以 Three.js 的 y（高度）= 原始的 z_ros
      const z_ros = originalVertices[i * 3 + 2];  // 原始 z = Three.js y
      
      if (z_ros >= actualMinHeight && z_ros <= actualMaxHeight) {
        filteredOriginalVertices.push(
          originalVertices[i * 3],
          originalVertices[i * 3 + 1],
          originalVertices[i * 3 + 2]
        );
        
        if (originalColors) {
          filteredOriginalColors.push(
            originalColors[i * 3],
            originalColors[i * 3 + 1],
            originalColors[i * 3 + 2]
          );
        }
      }
    }
    
    // 构建导出数据
    const exportData: OriginalPointData = {
      vertices: new Float32Array(filteredOriginalVertices),
      colors: filteredOriginalColors.length > 0 ? new Float32Array(filteredOriginalColors) : null,
      intensity: null,
      classification: null,
      count: filteredOriginalVertices.length / 3,
      format: this.originalPointData.format,
      fileName: this.originalPointData.fileName,
    };
    
    // 导出
    const { blob, fileName } = exportPointCloud(exportData, exportFormat);
    downloadBlob(blob, fileName);
    
    console.log(`导出完成: ${fileName}, ${exportData.count} 个点`);
  }

  // Waypoint 功能
  onCanvasClick(event: MouseEvent) {
    if (!this.waypointMode || !this.renderer || !this.camera) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(groundPlane, intersectPoint);

    if (intersectPoint) {
      intersectPoint.y = 0;
      this.addWaypoint(intersectPoint);
    }
  }

  addWaypoint(position: THREE.Vector3) {
    const waypointIndex = this.waypoints.length;

    const geometry = new THREE.SphereGeometry(0.5, 8, 6);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 28;
    canvas.height = 28;
    context!.fillStyle = 'white';
    context!.fillRect(0, 0, 28, 28);
    context!.fillStyle = 'black';
    context!.font = 'bold 32px Arial';
    context!.textAlign = 'center';
    context!.fillText((waypointIndex + 1).toString(), 13, 25);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1, 1, 1);
    sprite.position.copy(position);
    sprite.position.y += 1.5;

    const quaternion = new THREE.Quaternion(0, 0, 0, 1);

    const originalPosition = new THREE.Vector3(-position.z, -position.x, position.y);

    const waypoint: Waypoint = {
      id: waypointIndex,
      name: `waypoint${waypointIndex + 1}`,
      position: position.clone(),
      originalPosition: originalPosition.clone(),
      quaternion: quaternion.clone(),
      mesh: sphere,
      label: sprite,
    };

    this.waypoints.push(waypoint);
    this.waypointGroup.add(sphere);
    this.waypointGroup.add(sprite);

    if (this.waypoints.length > 1) {
      this.connectWaypoints(this.waypoints.length - 2, this.waypoints.length - 1);
    }

    this.onWaypointCountChange(this.waypoints.length);
    console.log(`Waypoint ${waypoint.name} added at:`, position);
  }

  connectWaypoints(fromIndex: number, toIndex: number) {
    if (
      fromIndex >= 0 &&
      fromIndex < this.waypoints.length &&
      toIndex >= 0 &&
      toIndex < this.waypoints.length &&
      fromIndex !== toIndex
    ) {
      const fromPos = this.waypoints[fromIndex].position;
      const toPos = this.waypoints[toIndex].position;

      const geometry = new THREE.BufferGeometry().setFromPoints([fromPos, toPos]);
      const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 });
      const line = new THREE.Line(geometry, material);

      const connection: WaypointConnection = {
        from: fromIndex,
        to: toIndex,
        line: line,
      };

      this.waypointConnections.push(connection);
      this.connectionGroup.add(line);

      console.log(`Connected waypoint ${fromIndex} to ${toIndex}`);
    }
  }

  clearWaypoints() {
    this.waypoints.forEach((waypoint) => {
      this.waypointGroup.remove(waypoint.mesh);
      this.waypointGroup.remove(waypoint.label);
      waypoint.mesh.geometry.dispose();
      (waypoint.mesh.material as THREE.Material).dispose();
      (waypoint.label.material as THREE.Material).dispose();
    });

    this.waypointConnections.forEach((connection) => {
      this.connectionGroup.remove(connection.line);
      connection.line.geometry.dispose();
      (connection.line.material as THREE.Material).dispose();
    });

    this.waypoints = [];
    this.waypointConnections = [];
    this.onWaypointCountChange(0);

    console.log('All waypoints cleared');
  }

  removeLastWaypoint() {
    if (this.waypoints.length === 0) {
      console.log('没有可删除的路点');
      return;
    }

    const lastWaypoint = this.waypoints.pop()!;

    this.waypointGroup.remove(lastWaypoint.mesh);
    this.waypointGroup.remove(lastWaypoint.label);
    lastWaypoint.mesh.geometry.dispose();
    (lastWaypoint.mesh.material as THREE.Material).dispose();
    (lastWaypoint.label.material as THREE.Material).dispose();

    const connectionsToRemove: number[] = [];
    for (let i = this.waypointConnections.length - 1; i >= 0; i--) {
      const connection = this.waypointConnections[i];
      if (connection.from === lastWaypoint.id || connection.to === lastWaypoint.id) {
        this.connectionGroup.remove(connection.line);
        connection.line.geometry.dispose();
        (connection.line.material as THREE.Material).dispose();
        connectionsToRemove.push(i);
      }
    }

    connectionsToRemove.forEach((index) => {
      this.waypointConnections.splice(index, 1);
    });

    this.onWaypointCountChange(this.waypoints.length);
    console.log(`路点 ${lastWaypoint.name} 已删除`);
  }

  exportWaypoints() {
    if (this.waypoints.length === 0) {
      alert('没有可导出的路点');
      return;
    }

    let yamlContent = 'task:\n';
    yamlContent += '  task1:\n';
    this.waypoints.forEach((wp) => {
      yamlContent += `    - ${wp.name}\n`;
    });
    yamlContent += '\n';
    yamlContent += 'waypoint:\n';
    this.waypoints.forEach((wp) => {
      const coords = [
        wp.originalPosition.x.toFixed(6),
        wp.originalPosition.y.toFixed(6),
        wp.originalPosition.z.toFixed(6),
        wp.quaternion.x.toFixed(6),
        wp.quaternion.y.toFixed(6),
        wp.quaternion.z.toFixed(6),
        wp.quaternion.w.toFixed(6),
      ];
      yamlContent += `  ${wp.name}: [${coords.join(', ')}]\n`;
    });

    const dataBlob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'waypoints.yaml';
    link.click();

    URL.revokeObjectURL(url);

    console.log('Waypoints exported');
  }

  toggleWaypointMode(enabled: boolean) {
    this.waypointMode = enabled;
    console.log('Waypoint mode:', enabled);
  }

  dispose() {
    if (this.renderer) {
      this.renderer.dispose();
      if (this.container.contains(this.renderer.domElement)) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }
}

// React 组件
const PointCloudVis: React.FC = () => {
  const [searchParams] = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PCDViewer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // DOM refs for controls
  const pointSizeSliderRef = useRef<HTMLInputElement>(null);
  const pointSizeValueRef = useRef<HTMLSpanElement>(null);
  const colorModeRef = useRef<HTMLSelectElement>(null);
  const minHeightSliderRef = useRef<HTMLInputElement>(null);
  const maxHeightSliderRef = useRef<HTMLInputElement>(null);
  const minHeightValueRef = useRef<HTMLSpanElement>(null);
  const maxHeightValueRef = useRef<HTMLSpanElement>(null);
  const waypointModeRef = useRef<HTMLInputElement>(null);
  const waypointCountRef = useRef<HTMLDivElement>(null);
  const pointCountRef = useRef<HTMLDivElement>(null);
  const loadStatusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 创建 viewer
    viewerRef.current = new PCDViewer(
      containerRef.current,
      (count) => {
        if (pointCountRef.current) {
          pointCountRef.current.textContent = `Points: ${count.toLocaleString()}`;
        }
      },
      (status) => {
        if (loadStatusRef.current) {
          loadStatusRef.current.textContent = status;
          handleHeightFilterChange();
        }
      },
      (count) => {
        if (waypointCountRef.current) {
          waypointCountRef.current.textContent = `路点数: ${count}`;
        }
      }
    );

    const viewer = viewerRef.current;

    // 检查 URL 参数并自动加载文件
    // 支持: ?url=xxx.pcd 或 ?file=xxx.pcd
    const urlParam = searchParams.get('url') || searchParams.get('file');
    if (urlParam) {
      console.log('Loading from URL parameter:', urlParam);
      viewer.loadFromURL(urlParam);
      // 更新输入框显示 URL
      if (urlInputRef.current) {
        urlInputRef.current.value = urlParam;
      }
    }

    // 窗口大小调整
    const handleResize = () => viewer.onWindowResize();
    window.addEventListener('resize', handleResize);

    // 点击事件
    const handleClick = (event: MouseEvent) => {
      if (viewer.waypointMode) {
        viewer.onCanvasClick(event);
      }
    };
    viewer.renderer?.domElement.addEventListener('click', handleClick);

    // 键盘事件
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' && viewer.waypointMode) {
        event.preventDefault();
        viewer.removeLastWaypoint();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      viewer.renderer?.domElement.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
      viewer.dispose();
    };
  }, [searchParams]);

  // 文件选择处理
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !viewerRef.current) return;

    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'pcd') {
      viewerRef.current.loadPCDFile(file);
    } else if (ext === 'ply') {
      viewerRef.current.loadPLYFile(file);
    } else if (ext === 'las') {
      viewerRef.current.loadLASFile(file);
    }
  };

  // 从 URL 加载
  const handleLoadFromURL = () => {
    if (!viewerRef.current || !urlInputRef.current) return;
    const url = urlInputRef.current.value.trim();
    if (url) {
      viewerRef.current.loadFromURL(url);
    }
  };

  // 取消加载
  const handleCancelLoad = () => {
    viewerRef.current?.cancelLoad();
  };

  // 设置降采样级别
  const handleDownsampleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const level = parseFloat(event.target.value);
    if (viewerRef.current) {
      viewerRef.current.setDownsampleLevel(level);
    }
  };

  // URL 输入框回车加载
  const handleURLKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleLoadFromURL();
    }
  };

  // 重置相机
  const handleResetCamera = () => {
    viewerRef.current?.resetCamera();
  };

  // 正交俯视
  const handleTopView = () => {
    viewerRef.current?.setTopView();
    // 正交俯视时点大小范围：0.01-2.5
    if (pointSizeSliderRef.current) {
      pointSizeSliderRef.current.max = '2.5';
    }
  };

  // 透视视图
  const handlePerspectiveView = () => {
    viewerRef.current?.setPerspectiveView();
    // 透视视图时点大小范围：0.01-1.1
    if (pointSizeSliderRef.current) {
      const currentValue = parseFloat(pointSizeSliderRef.current.value);
      pointSizeSliderRef.current.max = '1.1';
      // 如果当前值超过新的最大值，调整到最大值
      if (currentValue > 1.1) {
        pointSizeSliderRef.current.value = '1.1';
        viewerRef.current?.setPointSize(1.1);
        if (pointSizeValueRef.current) {
          pointSizeValueRef.current.textContent = '1.10';
        }
      }
    }
  };

  // 更新点大小
  const handlePointSizeChange = () => {
    if (!viewerRef.current || !pointSizeSliderRef.current || !pointSizeValueRef.current) return;
    const size = parseFloat(pointSizeSliderRef.current.value);
    viewerRef.current.setPointSize(size);
    pointSizeValueRef.current.textContent = size.toFixed(2);
  };

  // 更改颜色模式
  const handleColorModeChange = () => {
    if (!viewerRef.current || !colorModeRef.current) return;
    viewerRef.current.setColorMode(colorModeRef.current.value);
  };

  // 更新高度过滤器
  const handleHeightFilterChange = () => {
    if (
      !viewerRef.current ||
      !minHeightSliderRef.current ||
      !maxHeightSliderRef.current ||
      !minHeightValueRef.current ||
      !maxHeightValueRef.current
    )
      return;

    const minNormalized = parseFloat(minHeightSliderRef.current.value) / 100;
    const maxNormalized = parseFloat(maxHeightSliderRef.current.value) / 100;

    viewerRef.current.setHeightFilter(minNormalized, maxNormalized);

    // 更新显示值
    const viewer = viewerRef.current;
    if (viewer.minHeight !== null && viewer.maxHeight !== null) {
      const actualMin = viewer.minHeight + (viewer.maxHeight - viewer.minHeight) * minNormalized;
      const actualMax = viewer.minHeight + (viewer.maxHeight - viewer.minHeight) * maxNormalized;
      minHeightValueRef.current.textContent = actualMin.toFixed(1);
      maxHeightValueRef.current.textContent = actualMax.toFixed(1);
    }
  };

  // 重置高度过滤器
  const handleResetHeightFilter = () => {
    if (
      !viewerRef.current ||
      !minHeightSliderRef.current ||
      !maxHeightSliderRef.current ||
      !minHeightValueRef.current ||
      !maxHeightValueRef.current
    )
      return;

    viewerRef.current.resetHeightFilter();
    minHeightSliderRef.current.value = '0';
    maxHeightSliderRef.current.value = '100';

    const viewer = viewerRef.current;
    if (viewer.minHeight !== null && viewer.maxHeight !== null) {
      minHeightValueRef.current.textContent = viewer.minHeight.toFixed(1);
      maxHeightValueRef.current.textContent = viewer.maxHeight.toFixed(1);
    }
  };

  // 导出过滤后的点云
  const handleExportPointCloud = () => {
    if (!viewerRef.current) return;
    viewerRef.current.exportFilteredPointCloud();
  };

  // 切换路点模式
  const handleToggleWaypointMode = () => {
    if (!viewerRef.current || !waypointModeRef.current) return;
    const enabled = waypointModeRef.current.checked;
    viewerRef.current.toggleWaypointMode(enabled);
    document.body.style.cursor = enabled ? 'crosshair' : 'default';
  };

  // 清除路点
  const handleClearWaypoints = () => {
    viewerRef.current?.clearWaypoints();
  };

  // 删除最后一个路点
  const handleRemoveLastWaypoint = () => {
    viewerRef.current?.removeLastWaypoint();
  };

  // 导出路点
  const handleExportWaypoints = () => {
    viewerRef.current?.exportWaypoints();
  };

  return (
    <div className="pcd-viewer-container">
      <div ref={containerRef} id="container">
        <div id="controls">
          <div>Point Cloud Viewer</div>
          <input
            type="file"
            id="fileInput"
            ref={fileInputRef}
            accept=".pcd,.las,.ply"
            onChange={handleFileChange}
          />
          <div style={{ marginTop: 8 }}>
            {/* <label style={{ marginBottom: 4, fontSize: 11 }}>URL加载:</label> */}
            <input
              type="text"
              ref={urlInputRef}
              placeholder="或者输入点云URL"
              onKeyDown={handleURLKeyDown}
              style={{
                width: '70%',
                padding: '4px 6px',
                fontSize: 11,
                background: '#333',
                color: 'white',
                border: '1px solid #555',
                borderRadius: 3,
                boxSizing: 'border-box',
              }}
            />
            <button onClick={handleLoadFromURL} style={{ marginTop: 1 }}>
              加载URL
            </button>
            {/* <button onClick={handleCancelLoad} style={{ background: '#c33' }}>
              取消
            </button> */}
          </div>
          <div style={{ marginTop: 10 }}>
            <button onClick={handleResetCamera}>重置相机</button>
            <button onClick={handleTopView}>正交俯视</button>
            <button onClick={handlePerspectiveView}>透视视图</button>
          </div>

          <div style={{ marginTop: 10 }}>
            <label>
              点大小:{' '}
              <input
                type="range"
                id="pointSizeSlider"
                ref={pointSizeSliderRef}
                min="0.01"
                max="1.1"
                defaultValue="0.1"
                step="0.01"
                onInput={handlePointSizeChange}
              />
            </label>
            <span id="pointSizeValue" ref={pointSizeValueRef}>
              0.10
            </span>
          </div>

          <div style={{ marginTop: 10 }}>
            <label htmlFor="colorMode">着色模式:</label>
            <select id="colorMode" ref={colorModeRef} onChange={handleColorModeChange}>
              {/* <option value="default">默认</option> */}
              <option value="height" selected>
                高度渐变
              </option>
              <option value="rainbow">彩虹</option>
              <option value="heat">热力图</option>
            </select>
          </div>

          <div style={{ marginTop: 10 }}>
            <label htmlFor="downsample">降采样:</label>
            <select id="downsample" onChange={handleDownsampleChange} defaultValue="1">
              <option value="1">无 (原始)</option>
              <option value="2">2x (50%点)</option>
              <option value="4">4x (25%点)</option>
              <option value="8">8x (12.5%点)</option>
              <option value="16">16x (6.25%点)</option>
            </select>
          </div>

          <div style={{ marginTop: 10 }}>
            <label>高度过滤器:</label>
            <div>
              <label>
                最小:{' '}
                <input
                  type="range"
                  id="minHeightSlider"
                  ref={minHeightSliderRef}
                  min="0"
                  max="100"
                  defaultValue="0"
                  step="0.1"
                  onChange={handleHeightFilterChange}
                />
              </label>
              <span id="minHeightValue" ref={minHeightValueRef}>
                0.0
              </span>
            </div>
            <div>
              <label>
                最大:{' '}
                <input
                  type="range"
                  id="maxHeightSlider"
                  ref={maxHeightSliderRef}
                  min="0"
                  max="100"
                  defaultValue="100"
                  step="0.1"
                  onChange={handleHeightFilterChange}
                />
              </label>
              <span id="maxHeightValue" ref={maxHeightValueRef}>
                1000.0
              </span>
            </div>
            <button onClick={handleResetHeightFilter}>重置</button>
            <button onClick={handleExportPointCloud} style={{ marginLeft: 5 }}>导出</button>
          </div>

          <div style={{ marginTop: 15, borderTop: '1px solid #444', paddingTop: 10 }}>
            {/* <div>
              <strong>路点编辑模式</strong>
            </div>
            <div>
              <input
                type="checkbox"
                id="waypointMode"
                ref={waypointModeRef}
                onChange={handleToggleWaypointMode}
              />
              <label htmlFor="waypointMode">路点模式</label>
            </div>
            <button onClick={handleClearWaypoints}>全部删除</button>
            <button onClick={handleRemoveLastWaypoint}>删除上一个</button>
            <button onClick={handleExportWaypoints}>导出</button>
            <div id="waypointCount" ref={waypointCountRef}>
              路点数: 0
            </div> */}
          </div>

          <div>鼠标: 旋转·缩放·平移</div>
          <div>ROS坐标系: 红=X(前), 绿=Y(左), 蓝=Z(上)</div>
        </div>

        <div id="info">
          <div id="pointCount" ref={pointCountRef}>
            Points: 0
          </div>
          <div id="loadStatus" ref={loadStatusRef}>
            Ready
          </div>
        </div>
      </div>
    </div>
  );
};

export default PointCloudVis;
