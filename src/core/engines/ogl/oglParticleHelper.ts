import { Geometry, Program, Mesh, type OGLRenderingContext, Transform, Vec3, type Attribute, type AttributeData } from 'ogl';

import vertex from '@shaders/particlevertex.glsl';
import fragment from '@shaders/particlefragment.glsl';

export enum ParticleShape {
    RANDOM = 'random',
    SPHERE = 'sphere',
    CONE = 'cone',
}

export interface ParticleSystem {
    mesh: Mesh;
    shape: ParticleShape;
    baseColor: Vec3;
    intensity: number;
}

export const particleList: Record<string, ParticleSystem> = {};

export function createParticles(gl: OGLRenderingContext, shape: ParticleShape, baseColor: string, pointSize: number, intensity: number): ParticleSystem {
    const positions = new Float32Array(intensity * 3);
    const velocities = new Float32Array(intensity * 3);
    const baseColorArr = baseColor.split(',').map((c) => parseFloat(c));
    const baseColorVec = new Vec3(baseColorArr[0], baseColorArr[1], baseColorArr[2]);

    for (let i = 0; i < intensity; i++) {
        positions.set(generatePosition(shape), i * 3);
        velocities.set(generateVelocity(shape), i * 3);
    }

    const geometry = new Geometry(gl, {
        position: { size: 3, data: positions },
        velocity: { size: 3, data: velocities },
    });

    const program = new Program(gl, {
        vertex,
        fragment,
        uniforms: {
            uTime: { value: 0 },
            pointSize: { value: pointSize },
            baseColor: { value: baseColorVec },
        },
        transparent: true,
        depthTest: false,
    });

    return { mesh: new Mesh(gl, { mode: gl.POINTS, geometry, program }), shape, baseColor: baseColorVec, intensity };
}

export function updateIntensityFromMsg(body: string) {
    const msg = JSON.parse(body);
    const { sensor_id: sensorId, value } = msg;
    const particle = particleList[sensorId];
    const intensity = 14 * (value + 70); // this formula is for the wifi sensor only
    if (particle) {
        updateIntensity(particle, intensity);
    } else {
        console.error('ERROR: Received a value but sensor object is missing!', sensorId);
    }
}

export function updateIntensity(particles: ParticleSystem, newIntensity: number) {
    console.log("Updating particles to", newIntensity);
    const oldPositions = particles.mesh.geometry.getPosition().data!;
    const oldVelocities = particles.mesh.geometry.attributes.velocity!.data!;
    const previousIntensity = oldPositions.length / 3;
    const newPositions = new Float32Array(newIntensity * 3);
    const newVelocities = new Float32Array(newIntensity * 3);
    for (let i = 0; i < newIntensity * 3; i += 3) {
        if (i < previousIntensity * 3) {
            newPositions[i] = oldPositions[i];
            newPositions[i + 1] = oldPositions[i + 1];
            newPositions[i + 2] = oldPositions[i + 2];
            newVelocities[i] = oldVelocities[i];
            newVelocities[i + 1] = oldVelocities[i + 1];
            newVelocities[i + 2] = oldVelocities[i + 2];
        } else {
            newPositions.set(generatePosition(particles.shape), i);
            newVelocities.set(generateVelocity(particles.shape), i);
        }
    }

    const geometry = {
        position: { size: 3, data: newPositions },
        velocity: { size: 3, data: newVelocities },
    };

    updateGeometry(particles.mesh.geometry, geometry);
    particles.intensity = newIntensity;
}

export interface GeometryAttrs {
    [key: string]: Partial<Attribute>;
}

/** Copy-paste from https://github.com/oframe/ogl/issues/153 */
function updateGeometry(geometry: Geometry, attributes: GeometryAttrs) {
    geometry.attributes = attributes;
    // Store one VAO per program attribute locations order
    geometry.VAOs = {};
    geometry.drawRange = { start: 0, count: 0 };
    geometry.instancedCount = 0;
    // Unbind current VAO so that new buffers don't get added to active mesh
    geometry.gl.renderer.bindVertexArray(null);
    geometry.gl.renderer.currentGeometry = null;
    // Alias for state store to avoid redundant calls for global state
    geometry.glState = geometry.gl.renderer.state;
    // create the buffers
    for (let key in attributes) {
        geometry.addAttribute(key, attributes[key]);
    }
}

function generatePosition(shape: ParticleShape) {
    switch (shape) {
        case ParticleShape.CONE: {
            return [Math.random(), Math.random(), Math.random()];
        }
        case ParticleShape.SPHERE: {
            const size=0.2;
            return [(Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size];
        }
        default: {
            const size=0.2;
            // RANDOM or invalid shape
            return [(Math.random() - 0.5)*size, (Math.random() - 0.5)*size, (Math.random() - 0.5)*size];
        }
    }
}

function generateVelocity(shape: ParticleShape) {
    return [(Math.random() - 0.5) / 2, (Math.random() - 0.5) / 2, (Math.random() - 0.5) / 2];
}


let t = 100;

export function updateParticles(particles: ParticleSystem) {
    t += 1 / 600;

    // if (t % 10 == 0) {
    //     updateIntensity(particles, particles.intensity + 1);
    // }

    const positionsAttr = particles.mesh.geometry.getPosition();
    const positions = positionsAttr.data;
    if (!positions) {
        return;
    }

    switch (particles.shape) {
        case ParticleShape.CONE:
            updateCone(positions);
            break;
        case ParticleShape.RANDOM: {
            const velocities = particles.mesh.geometry.attributes.velocity.data!;
            updateRandom(positions, velocities);
            break;
        }
        case ParticleShape.SPHERE:
            updateSphere(positions);
            break;
    }

    particles.mesh.geometry.updateAttribute(positionsAttr);

    particles.mesh.program.uniforms.uTime.value = t;
}

function updateCone(positions: AttributeData) {
    for (let i = 0; i < positions.length!; i += 3) {
        const point = new Vec3(positions[i], positions[i + 1], positions[i + 2]);
        point.sub(new Vec3(0).copy(point).normalize().divide(60));
        if (point.len() < 0.1) {
            point.set(Math.random(), Math.random(), Math.random());
        }
        positions[i] = point.x;
        positions[i + 1] = point.y;
        positions[i + 2] = point.z;
    }
    return positions;
}

function updateSphere(positions: AttributeData) {
    const size=0.5;
    for (let i = 0; i < positions.length!; i += 3) {
        const point = new Vec3(positions[i], positions[i + 1], positions[i + 2]);
        point.sub(new Vec3(0).copy(point).normalize().divide(200));
        if (point.len() < 0.01) {
            point.set((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size);
        }
        positions[i] = point.x;
        positions[i + 1] = point.y;
        positions[i + 2] = point.z;
    }
    return positions;
}

function updateRandom(positions: AttributeData, velocities: AttributeData) {
    const size = 0.2;
    for (let i = 0; i < positions.length!; i += 3) {
        const point = new Vec3(positions[i], positions[i + 1], positions[i + 2]);
        //point.sub(new Vec3(0, 0, 0).copy(point).normalize().divide(60));
        point.add(new Vec3(velocities[i], velocities[i + 1], velocities[i + 2]).divide(30));

        if (point.x > size || point.y > size || point.z > size) {
            point.set((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size);
        }
        positions[i] = point.x;
        positions[i + 1] = point.y;
        positions[i + 2] = point.z;
    }
    return positions;
}
