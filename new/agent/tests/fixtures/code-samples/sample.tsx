import React, { useState, useEffect } from 'react';

export const MyComponent = ({ title }: { title: string }) => {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    console.log("mounted");
  }, []);

  return <div onClick={() => setCount(c => c + 1)}>{title}: {count}</div>;
};
