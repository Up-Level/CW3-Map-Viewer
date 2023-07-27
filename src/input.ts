const enum KeyCode {
    W = "KeyW",
    A = "KeyA",
    S = "KeyS",
    D = "KeyD",

    LeftShift = "ShiftLeft",
    Space = "Space"
}

let keys = new Set<KeyCode>();

let leftDown = false;
let rightDown = false;
let middleDown = false;

document.body.addEventListener("keydown", (e) => {
    keys.add(e.code as KeyCode);
});
document.body.addEventListener("keyup", (e) => {
    keys.delete(e.code as KeyCode);
});
document.addEventListener("mousedown", (e) => {
    switch (e.button) {
        case 0: leftDown = true; break;
        case 1: middleDown = true; break;
        case 2: rightDown = true; break;
    }
});
document.addEventListener("mouseup", (e) => {
    switch (e.button) {
        case 0: leftDown = false; break;
        case 1: middleDown = false; break;
        case 2: rightDown = false; break;
    }
});

function GetKey(code: KeyCode) {
    return keys.has(code);
}

function GetKeyDown(code: KeyCode) {
    throw "Not implemented";
}

function GetKeyUp(code: KeyCode) {
    throw "Not implemented";
}


/**
 * Returns whether the given mouse button is held down.
 * @param button 
 * 0 = left \
 * 1 = right \
 * 2 = middle
 */
function GetMouseButton(button: 0 | 1 | 2) {
    switch (button) {
        case 0: return leftDown;
        case 1: return rightDown;
        case 2: return middleDown;
        default: throw "Invalid mouse button number";
    }
}

export {
    GetKey,
    GetKeyDown,
    GetKeyUp,
    KeyCode,

    GetMouseButton
}