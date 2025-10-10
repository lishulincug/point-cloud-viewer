// PCD Viewer using Three.js
class PCDViewer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.pointCloud = null;
        this.currentPCDData = null;  // 現在のPCDデータを保持
        this.colorMode = 'default';  // カラーモード
        this.minHeight = null;  // 最小高度
        this.maxHeight = null;  // 最大高度
        this.heightFilterMin = 0;  // フィルタ最小値（正規化済み）
        this.heightFilterMax = 1;  // フィルタ最大値（正規化済み）
        
        // Waypoint機能
        this.waypointMode = false;
        this.waypoints = [];
        this.waypointConnections = [];
        this.waypointGroup = new THREE.Group();
        this.connectionGroup = new THREE.Group();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // ROS座標系でのデフォルトカメラ位置（後方・右・上から見る）
        this.defaultCameraPosition = { x: 50, y: 50, z: -50 };
        
        this.init();
        this.setupEventListeners();
    }
    
    init() {
        // シーンの作成
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        // カメラの作成
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            10000
        );
        this.camera.position.set(
            this.defaultCameraPosition.x,
            this.defaultCameraPosition.y,
            this.defaultCameraPosition.z
        );
        
        // レンダラーの作成
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        document.getElementById('container').appendChild(this.renderer.domElement);
        
        // コントロールの作成
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 1000;
        
        // ライティング
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 100);
        this.scene.add(directionalLight);
        
        // ROS座標系の軸ヘルパー
        // 軸の色: X軸(赤)=ROS前方→Three.js Z, Y軸(緑)=ROS左→Three.js -X, Z軸(青)=ROS上→Three.js Y
        this.createROSAxesHelper();
        
        // グリッドは削除されました
        
        // アニメーションループ
        this.animate();
    }
    
    createROSAxesHelper() {
        // ROS座標系の軸を作成
        // ROS: X=赤(前方), Y=緑(左), Z=青(上)
        // Three.js変換後: -Y=赤(前方), Z=緑(左), Y=青(上)
        
        const axisLength = 10;
        const axisGroup = new THREE.Group();
        
        // ROS X軸 (赤色, 前方) → Three.js Z軸
        const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, axisLength)
        ]);
        const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
        axisGroup.add(xAxis);
        
        // ROS Y軸 (緑色, 左) → Three.js -X軸
        const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(-axisLength, 0, 0)
        ]);
        const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
        axisGroup.add(yAxis);
        
        // ROS Z軸 (青色, 上) → Three.js Y軸
        const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, axisLength, 0)
        ]);
        const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
        const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);
        axisGroup.add(zAxis);
        
        this.scene.add(axisGroup);
        
        // Waypointグループをシーンに追加
        this.scene.add(this.waypointGroup);
        this.scene.add(this.connectionGroup);
    }
    
    setupEventListeners() {
        // ウィンドウリサイズ
        window.addEventListener('resize', () => this.onWindowResize());
        
        // ファイル入力
        document.getElementById('fileInput').addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file && file.name.endsWith('.pcd')) {
                this.loadPCDFile(file);
            }
        });
        
        // Waypointモード用のクリックイベント
        this.renderer.domElement.addEventListener('click', (event) => {
            if (this.waypointMode) {
                this.onCanvasClick(event);
            }
        });

        // キーボードイベント（Backspaceで最後のwaypointを削除）
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Backspace' && this.waypointMode) {
                event.preventDefault();
                this.removeLastWaypoint();
            }
        });
    }
    
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
    
    loadPCDFile(file) {
        this.updateLoadStatus('読み込み中...');
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const pcdData = this.parsePCD(event.target.result);
                this.createPointCloud(pcdData);
                this.updateLoadStatus('読み込み完了');
            } catch (error) {
                console.error('PCD parsing error:', error);
                this.updateLoadStatus('エラー: ' + error.message);
            }
        };
        reader.readAsText(file);
    }
    
    async loadDefaultPCD() {
        try {
            this.updateLoadStatus('デフォルトPCD読み込み中...');
            const response = await fetch('tsukuba_pointcloud.pcd');
            if (!response.ok) {
                throw new Error('ファイルが見つかりません');
            }
            const text = await response.text();
            const pcdData = this.parsePCD(text);
            this.createPointCloud(pcdData);
            this.updateLoadStatus('読み込み完了');
        } catch (error) {
            console.error('Default PCD loading error:', error);
            this.updateLoadStatus('エラー: ' + error.message);
        }
    }
    
    parsePCD(pcdText) {
        const lines = pcdText.split('\n');
        const header = {};
        let dataStartIndex = 0;
        
        // ヘッダー解析
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('DATA')) {
                dataStartIndex = i + 1;
                break;
            }
            
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
                const key = parts[0];
                const value = parts.slice(1);
                header[key] = value;
            }
        }
        
        // フィールド情報
        const fields = header['FIELDS'] || ['x', 'y', 'z'];
        const types = header['TYPE'] || ['F', 'F', 'F'];
        const sizes = header['SIZE'] || ['4', '4', '4'];
        const counts = header['COUNT'] || ['1', '1', '1'];
        const points = parseInt(header['POINTS'][0]) || 0;
        
        console.log('PCD Header:', header);
        console.log('Expected points:', points);
        
        // データ解析
        const vertices = [];
        const colors = [];
        
        const hasColor = fields.includes('rgb') || fields.includes('r');
        
        for (let i = dataStartIndex; i < lines.length && i - dataStartIndex < points; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = line.split(/\s+/).map(v => parseFloat(v));
            
            if (values.length >= 3 && !isNaN(values[0]) && !isNaN(values[1]) && !isNaN(values[2])) {
                // 座標（ROS座標系からThree.js座標系への変換）
                // ROS: X=前方, Y=左, Z=上 → Three.js: X=右, Y=上, Z=手前
                const x_ros = values[0];  // ROS X (前方)
                const y_ros = values[1];  // ROS Y (左)
                const z_ros = values[2];  // ROS Z (上)
                
                // Three.js座標系に変換（Z軸を反転表示）
                const x_threejs = -y_ros;  // ROS Y(左) → Three.js X(右) なので反転
                const y_threejs = z_ros;   // ROS Z(上) → Three.js Y(上)
                const z_threejs = -x_ros;  // ROS X(前方) → Three.js Z(手前) を反転表示
                
                vertices.push(x_threejs, y_threejs, z_threejs);
                
                // 色
                if (hasColor && values.length > 3) {
                    if (fields.includes('rgb')) {
                        // RGB packed format
                        const rgb = values[3];
                        const r = ((rgb >> 16) & 0xff) / 255;
                        const g = ((rgb >> 8) & 0xff) / 255;
                        const b = (rgb & 0xff) / 255;
                        colors.push(r, g, b);
                    } else if (fields.includes('r')) {
                        // Separate RGB channels
                        const rIndex = fields.indexOf('r');
                        const gIndex = fields.indexOf('g');
                        const bIndex = fields.indexOf('b');
                        
                        const r = values[rIndex] / 255;
                        const g = values[gIndex] / 255;
                        const b = values[bIndex] / 255;
                        colors.push(r, g, b);
                    } else {
                        colors.push(0.7, 0.7, 0.7); // デフォルト色
                    }
                } else {
                    colors.push(0.7, 0.7, 0.7); // デフォルト色
                }
            }
        }
        
        console.log('Parsed vertices:', vertices.length / 3);
        
        return {
            vertices: new Float32Array(vertices),
            colors: new Float32Array(colors),
            count: vertices.length / 3,
            originalColors: new Float32Array(colors)  // オリジナルの色を保存
        };
    }
    
    createPointCloud(pcdData) {
        // 既存のポイントクラウドを削除
        if (this.pointCloud) {
            this.scene.remove(this.pointCloud);
            this.pointCloud.geometry.dispose();
            this.pointCloud.material.dispose();
        }

        // 現在のPCDデータを保存
        this.currentPCDData = pcdData;

        // 高度範囲を計算
        this.calculateHeightRange(pcdData);

        // 高さフィルタを適用してデータを生成
        const filteredData = this.applyHeightFilter(pcdData);

        // カラーモードに応じて色を計算
        const colors = this.calculateColors(filteredData);

        // ジオメトリの作成
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(filteredData.vertices, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));        // マテリアルの作成
        const material = new THREE.PointsMaterial({
            size: 0.5,
            vertexColors: true,
            sizeAttenuation: true
        });
        
        // ポイントクラウドの作成
        this.pointCloud = new THREE.Points(geometry, material);
        this.scene.add(this.pointCloud);
        
        // バウンディングボックスを計算してカメラを調整
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        
        // カメラ位置を調整
        const distance = maxDim * 2;
        this.camera.position.set(
            center.x + distance,
            center.y + distance,
            center.z + distance
        );
        this.controls.target.copy(center);
        this.controls.update();
        
        // ポイント数を表示
        this.updatePointCount(filteredData.count);
    }
    
    resetCamera() {
        this.camera.position.set(
            this.defaultCameraPosition.x,
            this.defaultCameraPosition.y,
            this.defaultCameraPosition.z
        );
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }
    
    updatePointCount(count) {
        document.getElementById('pointCount').textContent = `Points: ${count.toLocaleString()}`;
    }
    
    updateLoadStatus(status) {
        document.getElementById('loadStatus').textContent = status;
    }

    calculateColors(pcdData) {
        if (this.colorMode === 'default') {
            return pcdData.originalColors;
        }

        const vertices = pcdData.vertices;
        const colors = new Float32Array(vertices.length);
        const vertexCount = vertices.length / 3;

        // Z値（高度）の範囲を計算
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < vertexCount; i++) {
            const z = vertices[i * 3 + 1]; // Y座標がThree.jsのZ軸（高度）
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }

        console.log(`Height range: ${minZ.toFixed(2)} to ${maxZ.toFixed(2)}`);

        // 各点の色を計算
        for (let i = 0; i < vertexCount; i++) {
            const z = vertices[i * 3 + 1]; // Y座標が高度
            const normalizedHeight = (z - minZ) / (maxZ - minZ);
            
            let r, g, b;
            
            switch (this.colorMode) {
                case 'height':
                    // 青（低）→緑（中）→赤（高）
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
                    // レインボーカラー
                    const hue = normalizedHeight * 300; // 0-300度
                    const rgb = this.hslToRgb(hue / 360, 1, 0.5);
                    r = rgb[0];
                    g = rgb[1];
                    b = rgb[2];
                    break;
                    
                case 'heat':
                    // ヒートマップ（黒→赤→黄→白）
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

    hslToRgb(h, s, l) {
        let r, g, b;

        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return [r, g, b];
    }

    calculateHeightRange(pcdData) {
        const vertices = pcdData.vertices;
        const vertexCount = vertices.length / 3;

        let minZ = Infinity;
        let maxZ = -Infinity;
        
        for (let i = 0; i < vertexCount; i++) {
            const z = vertices[i * 3 + 1]; // Y座標が高度（反転表示されている）
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }

        this.minHeight = minZ;
        this.maxHeight = maxZ;

        // スライダーの範囲を更新
        this.updateSliderRanges();
    }

    applyHeightFilter(pcdData) {
        const vertices = pcdData.vertices;
        const colors = pcdData.originalColors;
        const vertexCount = vertices.length / 3;

        const filteredVertices = [];
        const filteredColors = [];

        const actualMinHeight = this.minHeight + (this.maxHeight - this.minHeight) * this.heightFilterMin;
        const actualMaxHeight = this.minHeight + (this.maxHeight - this.minHeight) * this.heightFilterMax;

        for (let i = 0; i < vertexCount; i++) {
            const x = vertices[i * 3];
            const y = vertices[i * 3 + 1]; // 高度
            const z = vertices[i * 3 + 2];

            if (y >= actualMinHeight && y <= actualMaxHeight) {
                filteredVertices.push(x, y, z);
                filteredColors.push(
                    colors[i * 3],
                    colors[i * 3 + 1],
                    colors[i * 3 + 2]
                );
            }
        }

        return {
            vertices: new Float32Array(filteredVertices),
            colors: new Float32Array(filteredColors),
            originalColors: new Float32Array(filteredColors),
            count: filteredVertices.length / 3
        };
    }

    updateSliderRanges() {
        if (this.minHeight !== null && this.maxHeight !== null) {
            const minSlider = document.getElementById('minHeightSlider');
            const maxSlider = document.getElementById('maxHeightSlider');
            const minValue = document.getElementById('minHeightValue');
            const maxValue = document.getElementById('maxHeightValue');

            // スライダーの値を更新
            minSlider.value = this.heightFilterMin * 100;
            maxSlider.value = this.heightFilterMax * 100;

            // 実際の高度値を表示
            const actualMin = this.minHeight + (this.maxHeight - this.minHeight) * this.heightFilterMin;
            const actualMax = this.minHeight + (this.maxHeight - this.minHeight) * this.heightFilterMax;

            minValue.textContent = actualMin.toFixed(1);
            maxValue.textContent = actualMax.toFixed(1);
        }
    }

    setHeightFilter(minNormalized, maxNormalized) {
        this.heightFilterMin = Math.max(0, Math.min(1, minNormalized));
        this.heightFilterMax = Math.max(0, Math.min(1, maxNormalized));

        // 最小値が最大値を超えないようにする
        if (this.heightFilterMin > this.heightFilterMax) {
            this.heightFilterMin = this.heightFilterMax;
        }

        if (this.currentPCDData) {
            this.createPointCloud(this.currentPCDData);
        }

        this.updateSliderRanges();
    }

    resetHeightFilter() {
        this.heightFilterMin = 0;
        this.heightFilterMax = 1;
        
        if (this.currentPCDData) {
            this.createPointCloud(this.currentPCDData);
        }
        
        this.updateSliderRanges();
    }

    // Waypoint機能
    onCanvasClick(event) {
        // マウス座標を正規化座標に変換
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // レイキャストで地面との交点を計算
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // 地面平面（Y=0）との交点を計算
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPoint = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(groundPlane, intersectPoint);

        if (intersectPoint) {
            // waypointは常にY=0に配置
            intersectPoint.y = 0;
            this.addWaypoint(intersectPoint);
        }
    }

    addWaypoint(position) {
        const waypointIndex = this.waypoints.length;
        
        // Waypoint球体を作成
        const geometry = new THREE.SphereGeometry(0.5, 8, 6);
        const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(position);
        
        // 番号ラベル用のスプライト（簡易版）
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 64;
        canvas.height = 64;
        context.fillStyle = 'white';
        context.fillRect(0, 0, 64, 64);
        context.fillStyle = 'black';
        context.font = 'bold 32px Arial';
        context.textAlign = 'center';
        context.fillText((waypointIndex + 1).toString(), 32, 42);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(2, 2, 1);
        sprite.position.copy(position);
        sprite.position.y += 1.5;

        // デフォルトクォータニオン（向きなし）
        const quaternion = new THREE.Quaternion(0, 0, 0, 1);

        // 元の座標系（ROS座標系）での座標を計算（保存用）
        // Three.js座標 → ROS座標への逆変換（Z軸反転を考慮）
        const originalPosition = new THREE.Vector3(
            -position.z, // Three.js -Z → ROS X (前方) Z軸反転を考慮
            -position.x, // Three.js -X → ROS Y (左)
            position.y   // Three.js Y → ROS Z (上)
        );

        // Waypointデータを保存（表示座標と元座標の両方を保持）
        const waypoint = {
            id: waypointIndex,
            name: `waypoint${waypointIndex + 1}`,
            position: position.clone(),        // 表示用座標（Three.js座標系）
            originalPosition: originalPosition.clone(), // 保存用座標（ROS座標系）
            quaternion: quaternion.clone(),
            mesh: sphere,
            label: sprite
        };
        
        this.waypoints.push(waypoint);
        this.waypointGroup.add(sphere);
        this.waypointGroup.add(sprite);

        // 前のwaypointがある場合、自動的に接続
        if (this.waypoints.length > 1) {
            this.connectWaypoints(this.waypoints.length - 2, this.waypoints.length - 1);
        }

        this.updateWaypointCount();
        
        console.log(`Waypoint ${waypoint.name} added at:`, position);
    }

    connectWaypoints(fromIndex, toIndex) {
        if (fromIndex >= 0 && fromIndex < this.waypoints.length && 
            toIndex >= 0 && toIndex < this.waypoints.length && 
            fromIndex !== toIndex) {
            
            const fromPos = this.waypoints[fromIndex].position;
            const toPos = this.waypoints[toIndex].position;

            // 線を作成
            const geometry = new THREE.BufferGeometry().setFromPoints([fromPos, toPos]);
            const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 });
            const line = new THREE.Line(geometry, material);

            const connection = {
                from: fromIndex,
                to: toIndex,
                line: line
            };

            this.waypointConnections.push(connection);
            this.connectionGroup.add(line);
            
            console.log(`Connected waypoint ${fromIndex} to ${toIndex}`);
        }
    }

    clearWaypoints() {
        // すべてのwaypointを削除
        this.waypoints.forEach(waypoint => {
            this.waypointGroup.remove(waypoint.mesh);
            this.waypointGroup.remove(waypoint.label);
            waypoint.mesh.geometry.dispose();
            waypoint.mesh.material.dispose();
            waypoint.label.material.dispose();
        });
        
        // すべての接続を削除
        this.waypointConnections.forEach(connection => {
            this.connectionGroup.remove(connection.line);
            connection.line.geometry.dispose();
            connection.line.material.dispose();
        });

        this.waypoints = [];
        this.waypointConnections = [];
        this.updateWaypointCount();
        
        console.log('All waypoints cleared');
    }

    exportWaypoints() {
        if (this.waypoints.length === 0) {
            alert('エクスポートするwaypointがありません');
            return;
        }

        // 新しい形式でデータを作成
        const waypointData = {
            task: {
                task1: this.waypoints.map(wp => wp.name)
            },
            waypoint: {}
        };

        // 各waypointの座標とクォータニオンを設定（元座標を使用）
        this.waypoints.forEach(wp => {
            waypointData.waypoint[wp.name] = [
                wp.originalPosition.x,
                wp.originalPosition.y, 
                wp.originalPosition.z,
                wp.quaternion.x,
                wp.quaternion.y,
                wp.quaternion.z,
                wp.quaternion.w
            ];
        });

        // YAMLライクな形式でエクスポート
        let yamlContent = 'task:\n';
        yamlContent += '  task1:\n';
        this.waypoints.forEach(wp => {
            yamlContent += `    - ${wp.name}\n`;
        });
        yamlContent += '\n';
        yamlContent += 'waypoint:\n';
        this.waypoints.forEach(wp => {
            const coords = [
                wp.originalPosition.x.toFixed(6),
                wp.originalPosition.y.toFixed(6),
                wp.originalPosition.z.toFixed(6),
                wp.quaternion.x.toFixed(6),
                wp.quaternion.y.toFixed(6),
                wp.quaternion.z.toFixed(6),
                wp.quaternion.w.toFixed(6)
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
        
        console.log('Waypoints exported:', waypointData);
    }

    toggleWaypointMode(enabled) {
        this.waypointMode = enabled;
        if (enabled) {
            document.body.style.cursor = 'crosshair';
        } else {
            document.body.style.cursor = 'default';
        }
        console.log('Waypoint mode:', enabled);
    }

    updateWaypointCount() {
        const count = this.waypoints.length;
        document.getElementById('waypointCount').textContent = `Waypoints: ${count}`;
    }

    removeLastWaypoint() {
        if (this.waypoints.length === 0) {
            console.log('削除するwaypointがありません');
            return;
        }

        // 最後のwaypointを取得
        const lastWaypoint = this.waypoints.pop();

        // 3Dオブジェクトを削除
        this.waypointGroup.remove(lastWaypoint.mesh);
        this.waypointGroup.remove(lastWaypoint.label);
        
        // ジオメトリとマテリアルを破棄
        lastWaypoint.mesh.geometry.dispose();
        lastWaypoint.mesh.material.dispose();
        lastWaypoint.label.material.dispose();

        // 最後のwaypointに関連する接続を削除
        const connectionsToRemove = [];
        for (let i = this.waypointConnections.length - 1; i >= 0; i--) {
            const connection = this.waypointConnections[i];
            if (connection.from === lastWaypoint.id || connection.to === lastWaypoint.id) {
                // 接続線を削除
                this.connectionGroup.remove(connection.line);
                connection.line.geometry.dispose();
                connection.line.material.dispose();
                
                connectionsToRemove.push(i);
            }
        }

        // 配列から接続を削除
        connectionsToRemove.forEach(index => {
            this.waypointConnections.splice(index, 1);
        });

        this.updateWaypointCount();
        console.log(`Waypoint ${lastWaypoint.name} を削除しました`);
    }

    setColorMode(mode) {
        this.colorMode = mode;
        if (this.currentPCDData && this.pointCloud) {
            // フィルタリングされたデータに対してカラーモードを適用
            const filteredData = this.applyHeightFilter(this.currentPCDData);
            const colors = this.calculateColors(filteredData);
            this.pointCloud.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            this.pointCloud.geometry.attributes.color.needsUpdate = true;
        }
    }
}

// グローバル関数
let viewer;

function loadDefaultPCD() {
    if (viewer) {
        viewer.loadDefaultPCD();
    }
}

function resetCamera() {
    if (viewer) {
        viewer.resetCamera();
    }
}

function changeColorMode() {
    if (viewer) {
        const select = document.getElementById('colorMode');
        viewer.setColorMode(select.value);
    }
}

function updateHeightFilter() {
    if (viewer) {
        const minSlider = document.getElementById('minHeightSlider');
        const maxSlider = document.getElementById('maxHeightSlider');
        
        const minNormalized = parseFloat(minSlider.value) / 100;
        const maxNormalized = parseFloat(maxSlider.value) / 100;
        
        viewer.setHeightFilter(minNormalized, maxNormalized);
    }
}

function resetHeightFilter() {
    if (viewer) {
        viewer.resetHeightFilter();
    }
}

function toggleWaypointMode() {
    if (viewer) {
        const checkbox = document.getElementById('waypointMode');
        viewer.toggleWaypointMode(checkbox.checked);
    }
}

function clearWaypoints() {
    if (viewer) {
        viewer.clearWaypoints();
    }
}

function removeLastWaypoint() {
    if (viewer) {
        viewer.removeLastWaypoint();
    }
}

function exportWaypoints() {
    if (viewer) {
        viewer.exportWaypoints();
    }
}

// 初期化
window.addEventListener('DOMContentLoaded', () => {
    viewer = new PCDViewer();
});