import { createPerspective, mul, rotateX, rotateY, rotateZ, translate } from "./matrix.js";
import { RenderObject, Mesh, Vector3, ShaderProgram, Renderer } from "./rendering.js";
import * as Input from "./input.js";
import { produceHighlighted } from "./highlighter.js";
import { addTab, leftTabs } from "./mapEditor.js";
const vsSource = `#version 300 es
in vec3 vertex;
in vec3 uv;
in vec4 color;

out vec3 Uv;
out vec4 Color;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(vertex, 1);

    Uv = uv;
    Color = color;
}`;
const fsSource = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;

in vec3 Uv;
in vec4 Color;

out vec4 color;

uniform sampler2DArray diffuse;

void main() {
    vec4 col = texture(diffuse, Uv) * vec4(Color.rgb * 2.0, Color.a);
    if(col.a < 0.1) {
        discard;
    }
    color = col;
}`;
let mousePosition = new Vector3();
let Time = {
    deltaTime: 1 / 60
};
function clamp(v, min, max) {
    if (v < min)
        return min;
    if (v > max)
        return max;
    return v;
}
function GetBaseInput() {
    let p_Velocity = new Vector3();
    if (Input.GetKey("KeyW")) {
        p_Velocity.z += -1;
    }
    if (Input.GetKey("KeyS")) {
        p_Velocity.z += 1;
    }
    if (Input.GetKey("KeyA")) {
        p_Velocity.x += -1;
    }
    if (Input.GetKey("KeyD")) {
        p_Velocity.x += 1;
    }
    return p_Velocity;
}
class Camera extends RenderObject {
    constructor() {
        super();
        this.lastMouse = new Vector3();
        this.mainSpeed = 100;
        this.shiftAdd = 250;
        this.maxShift = 1000;
        this.camSens = 0.25;
        this.totalRun = 1;
        this.onUpdate = this.update;
        this.position.z = 250;
    }
    update() {
        if (Input.GetMouseButton(0)) {
            this.lastMouse = mousePosition.sub(this.lastMouse);
            let x = (-this.lastMouse.y * this.camSens) * Math.PI / 180;
            let y = (-this.lastMouse.x * this.camSens) * Math.PI / 180;
            let rot = new Vector3(x, 0, y);
            this.rotation.x += rot.x;
            this.rotation.y += rot.y;
            this.rotation.z += rot.z;
        }
        this.lastMouse = mousePosition.copy();
        var p = GetBaseInput();
        if (Input.GetKey("ShiftLeft")) {
            this.totalRun += Time.deltaTime;
            p = p.mul(this.totalRun).mul(this.shiftAdd);
            p.x = clamp(p.x, -this.maxShift, this.maxShift);
            p.y = clamp(p.y, -this.maxShift, this.maxShift);
            p.z = clamp(p.z, -this.maxShift, this.maxShift);
        }
        else {
            this.totalRun = clamp(this.totalRun * 0.5, 1, 1000);
            p = p.mul(this.mainSpeed);
        }
        p.rotateX(this.rotation.x);
        p.rotateY(this.rotation.y);
        p.rotateZ(this.rotation.z);
        p = p.mul(Time.deltaTime);
        if (Input.GetKey("Space")) {
            let f = this.position.y;
            this.Translate(p);
            this.position.y = f;
        }
        else {
            this.Translate(p);
        }
    }
}
async function createTexture(gl) {
    let tempCanvas = document.createElement("canvas");
    let context = tempCanvas.getContext("2d");
    let img = new Image();
    img.src = "./img/cw4/LandAtlas64.png";
    await new Promise(resolve => img.onload = resolve);
    let depth = 20 * 19 + 1;
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 6, gl.RGBA8, 96, 96, depth);
    for (let x = 0; x < 20; x++) {
        for (let y = 1; y < 20; y++) {
            context.drawImage(img, x * 102 + 3, y * 102 + 3 + 8, 96, 96, 0, 0, 96, 96);
            let data = context.getImageData(0, 0, 96, 96);
            let id = x + (19 - y) * 20;
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, id, 96, 96, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
        }
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 96, 96);
    context.strokeStyle = "#000";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(96, 0);
    context.lineTo(0, 96);
    context.lineTo(0, 0);
    context.stroke();
    context.closePath();
    let data = context.getImageData(0, 0, 96, 96);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, depth - 1, 96, 96, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    return texture;
}
function genMapMesh(data, shader) {
    let width = data.dict.get("cwidth").value;
    let height = data.dict.get("cheight").value;
    let theme = data.dict.get("world").dict.get("theme").dict;
    let textureIds = theme.get("b").value;
    let colors = theme.get("e").value;
    let scales = theme.get("c").value;
    let wallTexture = theme.get("j").value;
    let wallColor = theme.get("l").value;
    wallColor = [wallColor.x, wallColor.y, wallColor.z, wallColor.w];
    let terrain = data.dict.get("world").dict.get("t");
    let vertices = [];
    let uv = [];
    let color = [];
    function getUv(height, x, y) {
        let id = textureIds[height - 1];
        let scale = 0.5 / scales[height - 1];
        let x1 = x * scale;
        let y1 = y * scale;
        let x2 = x1 + scale;
        let y2 = y1 + scale;
        return {
            tl: [x1, y1, id],
            tr: [x2, y1, id],
            bl: [x1, y2, id],
            br: [x2, y2, id],
        };
    }
    function getH(x, y) {
        return terrain.value[x + (height - y - 1) * width];
    }
    let tempUv = [
        0, 0, wallTexture,
        1, 0, wallTexture,
        0, 1, wallTexture,
    ];
    function pushCol(count, col = [1, 1, 1, 1]) {
        for (let i = 0; i < count; i++) {
            color.push(...col);
        }
    }
    for (let x = 0; x < width - 1; x++) {
        for (let y = 0; y < height - 1; y++) {
            const tl = getH(x, y);
            const tr = getH(x + 1, y);
            const bl = getH(x, y + 1);
            const br = getH(x + 1, y + 1);
            function tlt() {
                let uvs = getUv(tl, x, y);
                vertices.push(x, y, tl, x + 1, y, tl, x, y + 1, tl);
                uv.push(...uvs.tl, ...uvs.tr, ...uvs.bl);
            }
            function brt() {
                let uvs = getUv(br, x, y);
                vertices.push(x + 1, y, tr, x + 1, y + 1, br, x, y + 1, bl);
                uv.push(...uvs.tr, ...uvs.br, ...uvs.bl);
            }
            if (tl == tr && tl == bl && tl == br) {
                if (tl == 0) {
                    continue;
                }
                let col = colors[tl - 1];
                tlt();
                brt();
                pushCol(6, [col.x, col.y, col.z, col.w]);
                continue;
            }
            if (tl == tr && tl == bl) {
                if (tl != 0) {
                    tlt();
                    let col = colors[tl - 1];
                    pushCol(3, [col.x, col.y, col.z, col.w]);
                }
                vertices.push(x + 1, y, tr, x + 1, y + 1, br, x, y + 1, bl);
                uv.push(...tempUv);
                pushCol(3, wallColor);
                continue;
            }
            if (tl == tr && tl == br) {
                if (tl != 0) {
                    let uvs = getUv(tr, x, y);
                    vertices.push(x, y, tl, x + 1, y, tr, x + 1, y + 1, br);
                    uv.push(...uvs.tl, ...uvs.tr, ...uvs.br);
                    let col = colors[tl - 1];
                    pushCol(3, [col.x, col.y, col.z, col.w]);
                }
                vertices.push(x, y, tl, x + 1, y + 1, br, x, y + 1, bl);
                uv.push(...tempUv);
                pushCol(3, wallColor);
                continue;
            }
            if (tl == br && tl == bl) {
                if (tl != 0) {
                    let uvs = getUv(bl, x, y);
                    vertices.push(x, y, tl, x + 1, y + 1, br, x, y + 1, bl);
                    uv.push(...uvs.tl, ...uvs.br, ...uvs.bl);
                    let col = colors[tl - 1];
                    pushCol(3, [col.x, col.y, col.z, col.w]);
                }
                vertices.push(x, y, tl, x + 1, y, tr, x + 1, y + 1, br);
                uv.push(...tempUv);
                pushCol(3, wallColor);
                continue;
            }
            if (tr == br && tr == bl) {
                if (tr != 0) {
                    brt();
                    let col = colors[tr - 1];
                    pushCol(3, [col.x, col.y, col.z, col.w]);
                }
                vertices.push(x, y, tl, x + 1, y, tr, x, y + 1, bl);
                uv.push(...tempUv);
                pushCol(3, wallColor);
                continue;
            }
            if (tl == tr || tr == br || br == bl || bl == tl) {
                vertices.push(x, y, tl, x + 1, y, tr, x + 1, y + 1, br, x, y, tl, x + 1, y + 1, br, x, y + 1, bl);
                uv.push(...tempUv);
                uv.push(...tempUv);
                pushCol(6, wallColor);
                continue;
            }
            if (tl == br && tr == bl) {
                if (tl > tr) {
                    vertices.push(x, y, tl, x + 1, y, tr, x + 1, y + 1, br, x, y, tl, x + 1, y + 1, br, x, y + 1, bl);
                    uv.push(...tempUv);
                    uv.push(...tempUv);
                    pushCol(6, wallColor);
                }
                else {
                    vertices.push(x, y, tl, x + 1, y, tr, x, y + 1, bl, x + 1, y, tr, x + 1, y + 1, br, x, y + 1, bl);
                    uv.push(...tempUv);
                    uv.push(...tempUv);
                    pushCol(6, wallColor);
                }
                continue;
            }
            if (tl == br) {
                vertices.push(x, y, tl, x + 1, y, tr, x + 1, y + 1, br, x, y, tl, x + 1, y + 1, br, x, y + 1, bl);
                uv.push(...tempUv);
                uv.push(...tempUv);
                pushCol(6, wallColor);
                continue;
            }
            if (tr == bl) {
                vertices.push(x, y, tl, x + 1, y, tr, x, y + 1, bl, x + 1, y, tr, x + 1, y + 1, br, x, y + 1, bl);
                uv.push(...tempUv);
                uv.push(...tempUv);
                pushCol(6, wallColor);
                continue;
            }
            vertices.push(x, y, tl, x + 1, y, tr, x + 1, y + 1, br, x, y, tl, x + 1, y + 1, br, x, y + 1, bl);
            uv.push(...tempUv);
            uv.push(...tempUv);
            pushCol(6, wallColor);
        }
        vertices.push(x, 0, getH(x, 0), x + 1, 0, getH(x + 1, 0), x, 0, 0, x + 1, 0, getH(x + 1, 0), x + 1, 0, 0, x, 0, 0, x, height - 1, getH(x, height - 1), x + 1, height - 1, getH(x + 1, height - 1), x, height - 1, 0, x + 1, height - 1, getH(x + 1, height - 1), x + 1, height - 1, 0, x, height - 1, 0);
        uv.push(0, getH(x, 0), wallTexture, 1, getH(x + 1, 0), wallTexture, 0, 0, wallTexture, 1, getH(x + 1, 0), wallTexture, 1, 0, wallTexture, 0, 0, wallTexture, 0, getH(x, height - 1), wallTexture, 1, getH(x + 1, height - 1), wallTexture, 0, 0, wallTexture, 1, getH(x + 1, height - 1), wallTexture, 1, 0, wallTexture, 0, 0, wallTexture);
        pushCol(12, wallColor);
    }
    for (let y = 0; y < height - 1; y++) {
        vertices.push(0, y, getH(0, y), 0, y + 1, getH(0, y + 1), 0, y, 0, 0, y + 1, getH(0, y + 1), 0, y + 1, 0, 0, y, 0, width - 1, y, getH(width - 1, y), width - 1, y + 1, getH(width - 1, y + 1), width - 1, y, 0, width - 1, y + 1, getH(width - 1, y + 1), width - 1, y + 1, 0, width - 1, y, 0);
        uv.push(0, getH(0, y), wallTexture, 1, getH(0, y + 1), wallTexture, 0, 0, wallTexture, 1, getH(0, y + 1), wallTexture, 1, 0, wallTexture, 0, 0, wallTexture, 0, getH(width - 1, y), wallTexture, 1, getH(width - 1, y), wallTexture, 0, 0, wallTexture, 1, getH(width - 1, y + 1), wallTexture, 1, 0, wallTexture, 0, 0, wallTexture);
        pushCol(12, wallColor);
    }
    for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] -= width / 2;
        vertices[i + 1] -= height / 2;
    }
    return new Mesh(shader, vertices, uv, color);
}
export class cw4MapViewer extends Renderer {
    init() {
        this.canvas.addEventListener("mousemove", (e) => {
            this.mouseX = mousePosition.x = e.clientX;
            this.mouseY = mousePosition.y = e.clientY;
        }, false);
        let gl = this.gl;
        this.shader = new ShaderProgram(this.gl, vsSource, fsSource);
        this.shader.vertexSize = 3;
        this.shader.uvSize = 3;
        this.shader.use();
        gl.clearColor(0.5, 0.5, 0.5, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
        gl.enable(gl.BLEND);
        createTexture(gl).then(x => this.atlas = x);
        this.cameraObject = new Camera();
        this.root.add(this.cameraObject);
        this.resize(this.container.clientWidth, this.container.clientHeight);
    }
    createProjection() {
        this.projectionMatrix = createPerspective(70, this.width / this.height, 100, 1);
        return this.projectionMatrix;
    }
    update() {
        let test = mul(this.projectionMatrix, rotateX(-this.cameraObject.rotation.x), rotateY(-this.cameraObject.rotation.y), rotateZ(-this.cameraObject.rotation.z), translate(-this.cameraObject.position.x, -this.cameraObject.position.y, -this.cameraObject.position.z));
        this.gl.uniformMatrix4fv(this.shader.uniformLocations.projectionMatrix, true, test);
    }
    loadMap(data) {
        let mesh = genMapMesh(data, this.shader);
        this.mapObject = new RenderObject(mesh);
        this.mapObject.position.z = -50;
        this.mapObject.texture = this.atlas;
        let val = 4;
        this.mapObject.scale.x = val;
        this.mapObject.scale.y = -val;
        this.mapObject.scale.z = val;
        this.root.add(this.mapObject);
        addTab({
            name: "Map Editor",
            closeAble: false,
            mainEl: this.container
        });
        if (data.dict.get("cpacks")) {
            for (const item of data.dict.get("cpacks").value) {
                let cpackName = item.dict.get("b").value;
                let scripts = item.dict.get("f").dict;
                for (const script of scripts) {
                    const el = script[1].dict;
                    let name = `${cpackName}/${el.get("a").value}`;
                    let code = new TextDecoder("utf-8").decode(el.get("b").value);
                    let node = document.createElement("div");
                    node.innerText = name;
                    let tab;
                    node.addEventListener("click", () => {
                        if (!tab) {
                            tab = addTab({
                                name: name,
                                onClose: () => {
                                    tab = null;
                                }
                            });
                            tab.classList.add("crplCode");
                            let highlight = document.createElement("div");
                            try {
                                produceHighlighted(code, highlight);
                            }
                            catch (e) {
                                console.error(e);
                            }
                            tab.appendChild(highlight);
                        }
                    });
                    leftTabs.script.tab.appendChild(node);
                }
            }
        }
        this.start();
    }
}
