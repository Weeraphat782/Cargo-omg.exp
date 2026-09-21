"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragOverEvent,
    DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Opportunity, OpportunityStage, isPickupToday } from '@/types/opportunity';
import { KanbanColumn } from './kanban-column';
import { KanbanCard } from './kanban-card';

// Custom hook for drag-to-scroll like Trello
function useDragToScroll() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Check if clicked on a card or interactive element
        const target = e.target as HTMLElement;
        const isCard = target.closest('[data-kanban-card]');
        const isButton = target.closest('button');
        const isLink = target.closest('a');
        const isInput = target.closest('input');

        // Only activate drag-to-scroll when NOT clicking on cards or buttons
        if (!isCard && !isButton && !isLink && !isInput) {
            setIsDragging(true);
            setStartX(e.pageX - (containerRef.current?.offsetLeft || 0));
            setScrollLeft(containerRef.current?.scrollLeft || 0);
            e.preventDefault();
        }
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = e.pageX - (containerRef.current?.offsetLeft || 0);
        const walk = (x - startX) * 2; // Scroll speed multiplier
        if (containerRef.current) {
            containerRef.current.scrollLeft = scrollLeft - walk;
        }
    }, [isDragging, startX, scrollLeft]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleMouseLeave = useCallback(() => {
        if (isDragging) {
            setIsDragging(false);
        }
    }, [isDragging]);

    return {
        containerRef,
        isDragging,
        handlers: {
            onMouseDown: handleMouseDown,
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onMouseLeave: handleMouseLeave,
        }
    };
}

const STAGES: OpportunityStage[] = [
    'inquiry',
    'quoting',
    'pending_docs',
    'pending_booking',
    'booking_requested',
    'awb_received',
    'waiting_for_pickup',
    'picked_up',
    'payment_received',
];

interface KanbanBoardProps {
    initialOpportunities: Opportunity[];
    onStageChange?: (opportunityId: string, newStage: OpportunityStage) => void;
    onEditOpportunity?: (opportunity: Opportunity) => void;
    onDeleteOpportunity?: (id: string) => void;
    onWinCase?: (id: string) => void;
    onLoseCase?: (id: string) => void;
    onReopenCase?: (id: string) => void;
    onRefresh?: () => void;
    onOpportunityPatch?: (opportunityId: string, patch: Partial<Opportunity>) => void;
    onReorder?: (updatedOpportunities: Opportunity[]) => void;
}

export function KanbanBoard({ initialOpportunities, onStageChange, onEditOpportunity, onDeleteOpportunity, onWinCase, onLoseCase, onReopenCase, onRefresh, onOpportunityPatch, onReorder }: KanbanBoardProps) {
    // Sync state with props
    const [opportunities, setOpportunities] = useState<Opportunity[]>(initialOpportunities);

    // Watch for prop changes (e.g. new item added from parent)
    useEffect(() => {
        setOpportunities(initialOpportunities);
    }, [initialOpportunities]);

    const [activeId, setActiveId] = useState<string | null>(null);
    const [startStage, setStartStage] = useState<OpportunityStage | null>(null);

    // Drag to scroll like Trello
    const { containerRef, isDragging, handlers } = useDragToScroll();

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const findContainer = (id: string, items: Opportunity[]) => {
        if (STAGES.includes(id as OpportunityStage)) {
            return id as OpportunityStage;
        }
        const item = items.find((o) => o.id === id);
        return item?.stage;
    };

    function handleDragStart(event: DragStartEvent) {
        const id = event.active.id as string;
        setActiveId(id);
        const stage = findContainer(id, opportunities);
        if (stage && STAGES.includes(stage)) {
            setStartStage(stage);
        }
    }

    function handleDragOver(event: DragOverEvent) {
        const { active, over } = event;
        const overId = over?.id;

        if (!overId || active.id === overId) return;

        setOpportunities((prev) => {
            const activeId = active.id as string;
            const overIdStr = overId as string;

            const activeContainer = findContainer(activeId, prev);
            const overContainer = findContainer(overIdStr, prev);

            if (!activeContainer || !overContainer) return prev;

            const activeIndex = prev.findIndex((o) => o.id === activeId);
            const overIndex = prev.findIndex((o) => o.id === overIdStr);

            // Common calculation for target index when dragging over a container (column background/header)
            let newIndex;
            if (overIndex !== -1) {
                newIndex = overIndex;
            } else {
                // If overIndex is -1, we're likely over a column itself (not a card)
                const containerItems = prev.filter(o => o.stage === overContainer);
                if (containerItems.length > 0) {
                    // Move to the end of that container
                    const lastItemInContainer = containerItems[containerItems.length - 1];
                    const lastIdx = prev.findIndex(o => o.id === lastItemInContainer.id);
                    newIndex = lastIdx + 1;
                } else {
                    // Empty column, move to end of all items (it's fine for Kanban list)
                    newIndex = prev.length;
                }
            }

            // Same-column reordering
            if (activeContainer === overContainer) {
                if (activeIndex !== -1 && newIndex !== -1 && activeIndex !== newIndex) {
                    return arrayMove(prev, activeIndex, newIndex);
                }
                return prev;
            }

            // Cross-column move
            const newItems = [...prev];
            const newStage = overContainer as OpportunityStage;
            newItems[activeIndex] = {
                ...newItems[activeIndex],
                stage: newStage,
                probability: getProbabilityForStage(newStage)
            };

            return arrayMove(newItems, activeIndex, newIndex);
        });
    }

    function handleDragEnd(event: DragEndEvent) {
        if (!event.over) {
            setActiveId(null);
            setStartStage(null);
            return;
        }

        const activeId = event.active.id as string;

        setOpportunities((prev) => {
            const item = prev.find(o => o.id === activeId);
            const currentStage = item?.stage;

            if (startStage && currentStage && startStage !== currentStage) {
                queueMicrotask(() => onStageChange?.(activeId, currentStage as OpportunityStage));
            }
            queueMicrotask(() => onReorder?.(prev));

            return prev;
        });

        setActiveId(null);
        setStartStage(null);
    }

    const getProbabilityForStage = (stage: OpportunityStage): number => {
        switch (stage) {
            case 'inquiry': return 10;
            case 'quoting': return 20;
            case 'pending_docs': return 30;
            case 'pending_booking': return 45;
            case 'booking_requested': return 60;
            case 'awb_received': return 75;
            case 'picked_up': return 80;
            case 'payment_received': return 85;
            default: return 0;
        }
    };

    const activeOpportunity = activeId ? opportunities.find(o => o.id === activeId) : null;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
        >
            <div
                ref={containerRef}
                className={`kanban-scroll-container flex h-full gap-4 overflow-x-auto pb-4 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                style={{ scrollBehavior: isDragging ? 'auto' : 'smooth' }}
                {...handlers}
            >
                <div className="kanban-scroll-area flex gap-4 min-w-max px-6">
                    {STAGES.map((stage) => {
                        const items = opportunities.filter((o) => o.stage === stage);
                        const columnItems = [
                            ...items.filter(isPickupToday),
                            ...items.filter((o) => !isPickupToday(o)),
                        ];
                        return (
                        <KanbanColumn
                            key={stage}
                            stage={stage}
                            opportunities={columnItems}
                            onEdit={onEditOpportunity}
                            onDelete={onDeleteOpportunity}
                            onWinCase={onWinCase}
                            onLoseCase={onLoseCase}
                            onReopenCase={onReopenCase}
                            onRefresh={onRefresh}
                            onOpportunityPatch={onOpportunityPatch}
                        />
                        );
                    })}
                </div>
            </div>

            <DragOverlay>
                {activeOpportunity ? <KanbanCard opportunity={activeOpportunity} /> : null}
            </DragOverlay>
        </DndContext>
    );
}
