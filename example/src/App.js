import React, { Component } from 'react';
import logo from './logo.svg';
import ArtQR from './qr';
import SharkImg from './shark.jpg';
import './App.css';

class App extends Component {
  constructor(props) {
    super(props);
    this.ArtQRInstance = null
  }

  componentDidMount() {
    this.renderQR();
  }

  renderQR = () => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = SharkImg;
    img.onload = () => {
      this.ArtQRInstance = new ArtQR().create({
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
      });
    }
  }

  downloadQRCode = () => {
    this.ArtQRInstance.download()
  }

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <h1 className="App-title">Art QR</h1>
        </header>
        <img src="" alt="qr" id="qrcode" className="qr-code" />
        <button onClick={this.downloadQRCode} className="download-button">download</button>
      </div>
    );
  }
}

export default App;
