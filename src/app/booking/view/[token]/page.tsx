'use client';

import { use } from 'react';
import { BookingSheet } from '@/components/booking/booking-sheet';

export default function PublicBookingViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <BookingSheet token={token} readOnly />;
}
