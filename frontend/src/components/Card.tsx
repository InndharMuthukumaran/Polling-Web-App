import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  as?: React.ElementType;
}

export const Card: React.FC<CardProps> = ({
  children,
  as: Component = 'div',
  className = '',
  ...props
}) => {
  return (
    <Component
      className={`bg-white rounded-2xl border border-neutral-200/80 shadow-sm p-5 sm:p-6 ${className}`.trim()}
      {...props}
    >
      {children}
    </Component>
  );
};
