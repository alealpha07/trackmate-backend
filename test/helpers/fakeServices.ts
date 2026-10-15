import http from "http";
import type { AddressInfo } from "net";
import { decodePolyline6 } from "../../src/routing/instructions/polyline.js";

export interface FakeRequest {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
}

export interface FakeReply {
    status?: number;
    body?: unknown;
}

type Handler = (request: FakeRequest) => FakeReply | Promise<FakeReply>;

export interface FakeService {
    url: string;
    requests: FakeRequest[];
    handle: Handler;
    close(): Promise<void>;
}

// a local stand-in for an outside service, the handler can be swapped per test
export async function fakeService(handle: Handler): Promise<FakeService> {
    const server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() };
        service.requests.push(request);
        try {
            const { status = 200, body = {} } = await service.handle(request);
            res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
        } catch (error) {
            res.writeHead(500).end(String(error));
        }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const service: FakeService = {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        requests: [],
        handle,
        close: () => new Promise((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
        }),
    };
    return service;
}

// echoes the trace with a start and an arrival, the texts tagged with the asked language
export function valhallaTrace(request: FakeRequest): FakeReply {
    const body = JSON.parse(request.body);
    const shape: string = body.encoded_polyline;
    const last = decodePolyline6(shape).length - 1;
    const language = body.directions_options?.language;
    return {
        body: {
            trip: {
                legs: [{
                    shape,
                    maneuvers: [
                        { type: 1, instruction: `${language}: Head east.`, begin_shape_index: 0, length: 1, time: 240 },
                        { type: 4, instruction: `${language}: You have arrived.`, begin_shape_index: last, length: 0, time: 0 },
                    ],
                }],
            },
        },
    };
}

export const PHOTON_PARMA = {
    features: [
        { properties: { name: "Parma", osm_key: "place", county: "Parma", country: "Italia" }, geometry: { coordinates: [10.328, 44.801] } },
        { properties: { name: "Stazione di Parma", osm_key: "railway", city: "Parma", country: "Italia" }, geometry: { coordinates: [10.327, 44.809] } },
    ],
};
