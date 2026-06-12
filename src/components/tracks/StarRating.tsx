'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { useRating } from '@/hooks/useRating';

interface StarRatingProps {
  trackId: string;
  initialRating: number;
  /** Called after the API confirms a new rating. Use this to refetch the
   *  parent's track data so the value sticks across drawer reopen / page
   *  refresh — React Query's invalidate fires too, but only helps parents
   *  that actually use React Query. */
  onChange?: (newRating: number) => void;
}

export function StarRating({ trackId, initialRating, onChange }: StarRatingProps) {
  const { rating, rate, loading } = useRating(trackId, initialRating, onChange);
  const [hover, setHover] = useState(0);

  const handleClick = (value: number) => {
    if (loading) return;
    // Click same star = clear rating (set to 0)
    const newValue = value === rating ? 0 : value;
    rate(newValue);
  };

  return (
    <div className="flex items-center gap-1 group/stars">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          disabled={loading}
          onClick={(e) => {
            e.stopPropagation();
            handleClick(star);
          }}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          className={`
            transition-all duration-200 transform
            ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-125 cursor-pointer'}
          `}
        >
          <Star
            size={14}
            className={`
              ${(hover || rating) >= star ? 'fill-[#D6BE7A] text-[#D6BE7A]' : 'fill-[#3B372F] text-[#3B372F]'}
              transition-colors duration-200
            `}
          />
        </button>
      ))}
      
      {rating > 0 && (
        <span className="text-[10px] font-bold text-[#D0C3AF] ml-1 opacity-0 group-hover/stars:opacity-100 transition-opacity whitespace-nowrap">
          {rating}/5
        </span>
      )}
    </div>
  );
}
