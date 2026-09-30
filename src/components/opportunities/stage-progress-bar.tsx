"use client";

import React from 'react';
import { OpportunityStage, STAGE_LABELS } from '@/types/opportunity';
import { Check } from 'lucide-react';

interface StageProgressBarProps {
    currentStage: OpportunityStage;
}

const STAGES: OpportunityStage[] = [
    'inquiry',
    'quoting',
    'pending_docs',
    'pending_booking',
    'booking_requested',
    'awb_received',
    'delivered',
    'payment_received'
];

export function StageProgressBar({ currentStage }: StageProgressBarProps) {
    const currentIndex = STAGES.indexOf(currentStage);

    return (
        <div className="w-full py-4 px-2">
            <div className="relative flex justify-between">
                {/* Connecting Line */}
                <div className="absolute top-4 left-0 w-full h-0.5 bg-gray-200 -z-10" />
                <div
                    className="absolute top-4 left-0 h-0.5 bg-emerald-500 transition-all duration-500 -z-10"
                    style={{ width: `${(currentIndex / (STAGES.length - 1)) * 100}%` }}
                />

                {STAGES.map((stage, index) => {
                    const isCompleted = index < currentIndex;
                    const isActive = index === currentIndex;
                    const label = STAGE_LABELS[stage];

                    return (
                        <div key={stage} className="flex flex-col items-center">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-300 border-2 ${isCompleted ? 'bg-emerald-500 border-emerald-500 text-white' :
                                        isActive ? 'bg-white border-emerald-500 text-emerald-600 ring-4 ring-emerald-50' :
                                            'bg-white border-gray-300 text-gray-400'
                                    }`}
                            >
                                {isCompleted ? (
                                    <Check className="h-4 w-4" />
                                ) : (
                                    <span className="text-xs font-bold">{index + 1}</span>
                                )}
                            </div>
                            <span className={`mt-2 text-[10px] font-medium uppercase tracking-wider text-center max-w-[80px] ${isActive ? 'text-emerald-700' : 'text-gray-500'
                                }`}>
                                {label}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
