import React, { Component } from 'react';
import logo from './logo.svg';
import ArtQR from './qr/bundle.cjs.js';
import SharkImg from './shark.jpg';
import './App.css';

class App extends Component {
  componentDidMount() {
    this.renderQR()
  }

  renderQR = () => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = SharkImg;
    img.onload = () => {
      new ArtQR().create({
        text: 'https://github.com/LIU9293/art-qr',
        size: 300,
        margin: 10,
        colorDark: 'rgba(16, 152, 173, 0.8)',
        colorLight: '#fff',
        backgroundImage: img,
        backgroundDimming: 'rgba(0,0,0,0)',
        logoImage: undefined,
        logoScale: 0.2,
        logoMargin: 0,
        logoCornerRadius: 8,
        whiteMargin: true,
        dotScale: 0.3,
        autoColor: true,
        binarize: false,
        binarizeThreshold: 128,
        bindElement: 'qrcode'
      })
    }
  }

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <h1 className="App-title">Welcome to React</h1>
        </header>
        <img src="" alt="qr" id="qrcode" className="qr-code" />
      </div>
    );
  }
}

export default App;
