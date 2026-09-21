"use client";

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Opportunity, STAGE_LABELS, OpportunityStage } from '@/types/opportunity';
import { KanbanCard } from './kanban-card';
import { getQuotationPayableTotalThb } from '@/lib/db';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
    stage: OpportunityStage;
    opportunities: Opportunity[];
    onEdit?: (opportunity: Opportunity) => void;
    onDelete?: (id: string) => void;
    onWinCase?: (id: string) => void;
    onLoseCase?: (id: string) => void;
    onReopenCase?: (id: string) => void;
    onRefresh?: () => void;
    onOpportunityPatch?: (opportunityId: string, patch: Partial<Opportunity>) => void;
}

export function KanbanColumn({ stage, opportunities, onEdit, onDelete, onWinCase, onLoseCase, onReopenCase, onRefresh, onOpportunityPatch }: KanbanColumnProps) {
    console.log(`KanbanColumn ${stage}: onEdit is`, !!onEdit);
    const { setNodeRef } = useDroppable({
        id: stage,
        data: {
            type: 'Column',
            stage,
        },
    });

    const totalAmount = opportunities.reduce((sum, opp) => {
        const quotationTotal =
            (opp.quotationDetails ?? [])
                .filter((q) =>
                    getQuotationPayableTotalThb({
                        total_cost: q.total_cost ?? 0,
                        vat_amount: q.vat_amount ?? null,
                        grand_total_with_vat: null,
                        wht_amount: q.wht_amount ?? null,
                        wht_enabled: q.wht_enabled,
                    }) > 0
                )
                .reduce(
                    (s, q) =>
                        s +
                        getQuotationPayableTotalThb({
                            total_cost: q.total_cost ?? 0,
                            vat_amount: q.vat_amount ?? null,
                            grand_total_with_vat: null,
                            wht_amount: q.wht_amount ?? null,
                            wht_enabled: q.wht_enabled,
                        }),
                    0
                );
        return sum + (quotationTotal > 0 ? quotationTotal : opp.amount);
    }, 0);

    return (
        <div className="flex flex-col h-full min-w-[280px] w-[300px] bg-gray-50/50 rounded-lg border p-2">
            <div className="mb-3 px-2">
                <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-sm">{STAGE_LABELS[stage]}</h3>
                    <span className="text-xs text-muted-foreground font-medium bg-gray-200 px-2 py-0.5 rounded-full">
                        {opportunities.length}
                    </span>
                </div>
                <p className="text-xs text-muted-foreground font-medium">
                    Total: {totalAmount.toLocaleString()} THB
                </p>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
                <div ref={setNodeRef} className={cn("flex flex-col gap-2 px-2 py-2 min-h-[150px]")}>
                    <SortableContext items={opportunities.map(o => o.id)} strategy={verticalListSortingStrategy}>
                        {opportunities.map((opportunity) => (
                            <KanbanCard
                                key={opportunity.id}
                                opportunity={opportunity}
                                onEdit={onEdit}
                                onDelete={onDelete}
                                onWinCase={onWinCase}
                                onLoseCase={onLoseCase}
                                onReopenCase={onReopenCase}
                                onRefresh={onRefresh}
                                onOpportunityPatch={onOpportunityPatch}
                            />
                        ))}
                    </SortableContext>
                </div>
            </div>
        </div>
    );
}
