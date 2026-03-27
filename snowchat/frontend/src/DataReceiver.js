import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const DataReceiver = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    const socket = io('http://localhost:5000');

    socket.on('newDataReceived', (receivedData) => {
      console.log('Received data from the server is :', receivedData);
      setTimeout(() => {
        setData(receivedData);
      }, 1000);
      setData(receivedData);  // Update state with received data
    });

    return () => {
        console.log('Before disconnect :');
        

        socket.disconnect();  // Cleanup on component unmount
    };
  }, []);

   // Log data whenever it changes
   useEffect(() => {
    console.log('data inside is per effect ', data);
    console.log('question_row value per effect is:', data ? data.question_row : 'No data per effect');
  }, [data]);

  const renderObject = (obj) => {
    return Object.entries(obj).map(([key, value], index) => (
      <div key={index}>
        <strong>{key}:</strong> {value}
      </div>
    ));
  };

  return (
    <div>
      <h1>Received Data:</h1>
      <table border="1">
        <thead>
          <tr>
            <th>key</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {
            Object.entries(data.question_row).map(([key, value]) => (
              <tr key = {key}>
                <td>{key}</td>
                <td>{value}</td>
              </tr>
            ))}
             </tbody>
             </table>
             <table border="1" style={{
              paddingTop: "40px"
             }}>
        <thead>
          <tr>
            <th>key</th>
            <th>value</th>
          </tr>
        </thead>
       
        <tbody>
            {data.relevant_rows.map((row, index ) => (
              Object.entries(row).map(([key, value]) => (
                <tr key = {`${index}-${key}`}>
                <td>{`${key}`}</td>
                <td>{value}</td>
                </tr>
              ))
             
            ))}
           </tbody>
           </table>
       
       
    </div>
  );
};

export default DataReceiver;
