import { useState, useRef, useEffect } from "react";
import { Card, Button, Text, Box } from "@shopify/polaris";

interface Accessory {
    id: string;
    title: string;
    imageUrl: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface CanvasEditorProps {
    baseImageUrl: string;
    accessories: Accessory[];
    onPositionsChange: (positions: Record<string, { x: number; y: number; width: number; height: number }>) => void;
    readOnly?: boolean;
    onSave?: () => void;
}

export function CanvasEditor({ baseImageUrl, accessories, onPositionsChange, readOnly, onSave }: CanvasEditorProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 800 });
    const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
    const [accessoryImages, setAccessoryImages] = useState<Record<string, HTMLImageElement>>({});
    const [originalSizes, setOriginalSizes] = useState<Record<string, { w: number; h: number }>>({});
    const [dragging, setDragging] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [positions, setPositions] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
    // readOnly and onSave are destructured from props
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => setBaseImage(img);
        img.src = baseImageUrl;
    }, [baseImageUrl]);

    useEffect(() => {
        const loadAccessories = async () => {
            const images: Record<string, HTMLImageElement> = {};
            const sizes: Record<string, { w: number; h: number }> = {};
            for (const acc of accessories) {
                const img = new Image();
                img.crossOrigin = "anonymous";
                await new Promise((resolve) => {
                    img.onload = () => resolve(true);
                    img.onerror = () => {
                        console.error("Accessory image failed to load:", acc.id, acc.imageUrl);
                        resolve(true);
                    };

                    // handle file_reference JSON payloads or raw urls
                    let src = acc.imageUrl || '';
                    if (src && (src.trim().startsWith('{') || src.trim().startsWith('['))) {
                        try {
                            const parsed = JSON.parse(src);
                            // common keys for file references
                            src = parsed.url || parsed.src || parsed.value || parsed.secure_url || src;
                        } catch (e) {
                            // leave src as-is
                        }
                    }

                    img.src = src;
                });
                images[acc.id] = img;
                sizes[acc.id] = { w: img.naturalWidth || img.width || 100, h: img.naturalHeight || img.height || 100 };
            }
            setAccessoryImages(images);
            setOriginalSizes(sizes);

            // Initialize positions for accessories that don't already have values
            setPositions(prev => {
                const out = { ...prev };
                for (const acc of accessories) {
                    if (out[acc.id]) continue; // keep existing saved pos
                    const imgSize = sizes[acc.id] || { w: 100, h: 100 };
                    // fit original size into canvas (max 80% of canvas width)
                    const maxW = Math.round(canvasSize.width * 0.8);
                    const scale = imgSize.w > maxW ? maxW / imgSize.w : 1;
                    const w = Math.round(imgSize.w * scale);
                    const h = Math.round(imgSize.h * scale);
                    out[acc.id] = {
                        x: Math.round((canvasSize.width - w) / 2),
                        y: Math.round((canvasSize.height - h) / 2),
                        width: w,
                        height: h,
                    };
                }
                return out;
            });
        };
        loadAccessories();
    }, [accessories]);

    useEffect(() => {
        // Merge initial positions from incoming accessory props but don't overwrite any existing state
        setPositions(prev => {
            const out = { ...prev };
            accessories.forEach(acc => {
                if (out[acc.id]) return; // keep existing
                // support both absolute pixels and normalized (0..1) values stored in metafields
                if (acc.x <= 1 && acc.y <= 1 && acc.width <= 1 && acc.height <= 1) {
                    out[acc.id] = {
                        x: Math.round(acc.x * canvasSize.width),
                        y: Math.round(acc.y * canvasSize.height),
                        width: Math.round(acc.width * canvasSize.width),
                        height: Math.round(acc.height * canvasSize.height),
                    };
                } else {
                    out[acc.id] = { x: acc.x, y: acc.y, width: acc.width, height: acc.height };
                }
            });
            return out;
        });
    }, [accessories]);

    // Ensure canvas displays at its internal resolution and support high-DPI
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const displayWidth = canvasSize.width;
        const displayHeight = canvasSize.height;
        const dpr = window.devicePixelRatio || 1;

        // Set actual pixel size taking DPR into account
        canvas.width = Math.round(displayWidth * dpr);
        canvas.height = Math.round(displayHeight * dpr);
        // CSS size (so it doesn't appear stretched)
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;

        // Normalize coordinate system to CSS pixels
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Redraw after resizing
        draw();
    }, [canvasSize, baseImage, accessoryImages, positions]);

    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const displayW = canvasSize.width;
        const displayH = canvasSize.height;

        ctx.clearRect(0, 0, displayW, displayH);
        if (baseImage) {
            ctx.drawImage(baseImage, 0, 0, displayW, displayH);
        }
        Object.entries(positions).forEach(([id, pos]) => {
            const img = accessoryImages[id];
            if (img) {
                ctx.drawImage(img, pos.x, pos.y, pos.width, pos.height);
            }
        });
    };

    useEffect(() => {
        draw();
    }, [baseImage, accessoryImages, positions]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (readOnly) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (const [id, pos] of Object.entries(positions)) {
            if (x >= pos.x && x <= pos.x + pos.width && y >= pos.y && y <= pos.y + pos.height) {
                setDragging(id);
                setSelected(id);
                break;
            }
        }
        // if clicked outside any accessory, clear selection
        const hit = Object.values(positions).some(pos => x >= pos.x && x <= pos.x + pos.width && y >= pos.y && y <= pos.y + pos.height);
        if (!hit) setSelected(null);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (readOnly) return;
        if (!dragging) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setPositions(prev => ({
            ...prev,
            [dragging]: {
                ...prev[dragging],
                x: x - prev[dragging].width / 2,
                y: y - prev[dragging].height / 2,
            }
        }));
    };

    const handleMouseUp = () => {
        if (readOnly) return;
        setDragging(null);
    };

    return (
        <Card>
            <Box padding="400">
                <Text variant="headingMd" as="h2">Canvas Editor</Text>
                <Box paddingBlockStart="400">
                    <canvas
                        ref={canvasRef}
                        width={canvasSize.width}
                        height={canvasSize.height}
                        style={{ border: "1px solid #ccc", cursor: readOnly ? "default" : (dragging ? "grabbing" : "grab") }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                    />
                </Box>
                {!readOnly && selected && (
                    <Box paddingBlockStart="400">
                        <Text as="p">Selected accessory: {selected}</Text>
                        <Box paddingBlockStart="200">
                            <label>Size</label>
                            <input
                                type="range"
                                min={0.1}
                                max={3}
                                step={0.01}
                                value={(() => {
                                    const orig = originalSizes[selected];
                                    const pos = positions[selected];
                                    if (!orig || !pos) return 1;
                                    return Number((pos.width / orig.w).toFixed(2));
                                })()}
                                onChange={(e) => {
                                    const val = Number((e.target as HTMLInputElement).value);
                                    const orig = originalSizes[selected];
                                    if (!orig) return;
                                    setPositions(prev => {
                                        const cur = prev[selected];
                                        if (!cur) return prev;
                                        const centerX = cur.x + cur.width / 2;
                                        const centerY = cur.y + cur.height / 2;
                                        const newW = Math.round(orig.w * val);
                                        const newH = Math.round(orig.h * val);
                                        return {
                                            ...prev,
                                            [selected]: {
                                                ...cur,
                                                width: newW,
                                                height: newH,
                                                x: Math.round(centerX - newW / 2),
                                                y: Math.round(centerY - newH / 2),
                                            }
                                        };
                                    });
                                }}
                            />
                        </Box>
                    </Box>
                )}
                <Box paddingBlockStart="400">
                    {!readOnly && (
                        <Button onClick={() => {
                            // send normalized positions (fractions relative to display size)
                            const normalized: Record<string, { x: number; y: number; width: number; height: number }> = {};
                            Object.entries(positions).forEach(([id, pos]) => {
                                // prefer numeric id (Liquid product.id) for storefront compatibility
                                const numericId = String(id).includes('/') ? String(id).split('/').pop() : String(id);
                                normalized[numericId] = {
                                    x: Number((pos.x / canvasSize.width).toFixed(6)),
                                    y: Number((pos.y / canvasSize.height).toFixed(6)),
                                    width: Number((pos.width / canvasSize.width).toFixed(6)),
                                    height: Number((pos.height / canvasSize.height).toFixed(6)),
                                };
                                // also include original id key (backwards compatibility)
                                normalized[id] = normalized[numericId];
                            });
                            onPositionsChange(normalized);
                            if (onSave) onSave();
                        }}>Save Positions</Button>
                    )}
                </Box>
            </Box>
        </Card>
    );
}